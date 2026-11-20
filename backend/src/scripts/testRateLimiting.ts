import axios from 'axios'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { COOKIE_NAME } from '../routes/auth'
import { emailQueue } from '../jobs/emailQueue'
import { createEmailWorker } from '../jobs/emailWorker'
import { registerSender } from '../services/emailService'
import { reserveSenderSlot, getSenderRateLimitStatus } from '../services/rateLimiterService'
import { redisConnection } from '../config/redis'

const BASE_URL = `http://localhost:${env.PORT}`

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runRateLimitingTests() {
  console.log('🧪 Starting ReachInbox Rate Limiting & Concurrency Tests...\n')
  let passed = 0
  let failed = 0

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`)
      passed++
    } else {
      console.error(`❌ FAIL: ${testName}`, details || '')
      failed++
    }
  }

  let testUser: any
  let senderWithLimit3: any
  let worker: any

  try {
    // 0. Setup test user
    const testEmail = `ratelimit.tester.${Date.now()}@reachinbox.example.com`
    testUser = await prisma.user.create({
      data: {
        name: 'Rate Limit Tester',
        email: testEmail,
      },
    })
    const token = jwt.sign(
      { userId: testUser.id, email: testUser.email },
      env.JWT_SECRET,
      { expiresIn: '1d' }
    )
    const authHeaders = {
      Cookie: `${COOKIE_NAME}=${token}`,
    }

    // 1. Register a sender in PostgreSQL with hourlyLimit = 3
    console.log('--- Step 1: Register Sender with hourlyLimit = 3 ---')
    senderWithLimit3 = await registerSender({
      userId: testUser.id,
      name: 'Throttled Dispatcher',
      email: 'throttled@reachinbox.test',
      hourlyLimit: 3, // EXACT TEST REQUIREMENT: limit = 3
    })
    assert(senderWithLimit3.hourlyLimit === 3, 'Sender created with hourlyLimit = 3 in PostgreSQL')

    // Clean any prior Redis keys for this sender
    const hourlyKey = `ratelimit:sender:${senderWithLimit3.id}:hourly`
    const lastSendKey = `ratelimit:sender:${senderWithLimit3.id}:last_send`
    await redisConnection.del(hourlyKey, lastSendKey)

    // 2. Direct Atomic Lua Script Verification
    console.log('\n--- Step 2: Atomic Lua Script Multi-Worker Verification ---')
    // Attempt 1 -> Should be allowed
    const r1 = await reserveSenderSlot({
      senderId: senderWithLimit3.id,
      emailId: 'test-email-1',
      maxHourlyLimit: 3,
      minDelayMs: 0,
      windowMs: 60000,
    })
    assert(r1.allowed === true && r1.currentCount === 1, 'Email 1 slot reserved (count: 1/3)')

    // Attempt 2 -> Should be allowed
    const r2 = await reserveSenderSlot({
      senderId: senderWithLimit3.id,
      emailId: 'test-email-2',
      maxHourlyLimit: 3,
      minDelayMs: 0,
      windowMs: 60000,
    })
    assert(r2.allowed === true && r2.currentCount === 2, 'Email 2 slot reserved (count: 2/3)')

    // Attempt 3 -> Should be allowed
    const r3 = await reserveSenderSlot({
      senderId: senderWithLimit3.id,
      emailId: 'test-email-3',
      maxHourlyLimit: 3,
      minDelayMs: 0,
      windowMs: 60000,
    })
    assert(r3.allowed === true && r3.currentCount === 3, 'Email 3 slot reserved (count: 3/3 - quota full)')

    // Attempt 4 -> MUST BE REJECTED & RESCHEDULED
    const r4 = await reserveSenderSlot({
      senderId: senderWithLimit3.id,
      emailId: 'test-email-4',
      maxHourlyLimit: 3,
      minDelayMs: 0,
      windowMs: 60000,
    })
    assert(r4.allowed === false, 'Email 4 rejected (hourly limit exceeded)')
    assert(r4.reason === 'HOURLY_LIMIT_EXCEEDED', 'Reason accurately reports "HOURLY_LIMIT_EXCEEDED"')
    assert(r4.delayNeededMs > 0, `delayNeededMs computed: ${r4.delayNeededMs}ms`)
    assert(!!r4.nextAvailableTime, `nextAvailableTime calculated: ${r4.nextAvailableTime?.toISOString()}`)

    // Attempt 5 -> MUST BE REJECTED & RESCHEDULED
    const r5 = await reserveSenderSlot({
      senderId: senderWithLimit3.id,
      emailId: 'test-email-5',
      maxHourlyLimit: 3,
      minDelayMs: 0,
      windowMs: 60000,
    })
    assert(r5.allowed === false, 'Email 5 rejected (hourly limit exceeded)')
    assert(r5.reason === 'HOURLY_LIMIT_EXCEEDED', 'Reason accurately reports "HOURLY_LIMIT_EXCEEDED"')

    // Reset Redis keys before full end-to-end BullMQ test
    await redisConnection.del(hourlyKey, lastSendKey)

    // 3. End-to-End Scheduler Test: Schedule 5 Emails for Same Sender (Limit = 3)
    console.log('\n--- Step 3: End-to-End Test: Schedule 5 Emails for Same Sender ---')
    const fiveRecipients = [
      'batch-user-1@reachinbox.test',
      'batch-user-2@reachinbox.test',
      'batch-user-3@reachinbox.test',
      'batch-user-4@reachinbox.test',
      'batch-user-5@reachinbox.test',
    ]

    const scheduleRes = await axios.post(
      `${BASE_URL}/api/emails/schedule`,
      {
        subject: 'Rate Limit Test Campaign',
        body: '<p>Testing per-sender hourly quota throttling</p>',
        recipients: fiveRecipients,
        senderId: senderWithLimit3.id,
        delayBetweenEmails: 0, // No manual extra delay
      },
      { headers: authHeaders }
    )

    assert(scheduleRes.status === 201, 'POST /api/emails/schedule scheduled 5 emails')
    const scheduledList = scheduleRes.data.emails
    assert(scheduledList.length === 5, '5 emails created in database and queue')

    const emailIds = scheduledList.map((e: any) => e.id)

    // 4. Start Worker with WORKER_CONCURRENCY
    console.log('\n--- Step 4: Start Worker Process & Verify Throttling Behavior ---')
    worker = createEmailWorker(3)

    console.log('Worker running... Processing jobs. Polling until 3 emails sent (max 25s)...')
    const pollStart = Date.now()
    while (Date.now() - pollStart < 25000) {
      const sentCount = await prisma.email.count({
        where: { id: { in: emailIds }, status: 'sent' },
      })
      if (sentCount >= 3) {
        console.log(`First wave reached ${sentCount} sent emails at ${(Date.now() - pollStart) / 1000}s.`)
        break
      }
      await sleep(1000)
    }

    // Give a short grace period (3s) to ensure worker doesn't mistakenly send a 4th email
    await sleep(3000)

    // 5. Query PostgreSQL database results
    console.log('\n--- Step 5: Verify Database Records ---')
    const emailsInDb = await prisma.email.findMany({
      where: { id: { in: emailIds } },
      orderBy: { createdAt: 'asc' },
    })

    const sentEmails = emailsInDb.filter((e) => e.status === 'sent')
    const delayedEmails = emailsInDb.filter((e) => e.status === 'scheduled')
    const failedEmails = emailsInDb.filter((e) => e.status === 'failed')

    console.log(`Summary of 5 emails in database:`)
    console.log(`  - Sent:      ${sentEmails.length}`)
    console.log(`  - Scheduled: ${delayedEmails.length}`)
    console.log(`  - Failed:    ${failedEmails.length}`)

    // EXACT USER REQUIREMENTS VERIFICATION:
    // "Verify that the first 3 can send within the current hourly window."
    assert(sentEmails.length === 3, 'Exactly first 3 emails were sent within current window')
    sentEmails.forEach((e, idx) => {
      assert(!!e.sentAt, `Sent email ${idx + 1} (${e.recipient}) has sentAt: ${e.sentAt?.toISOString()}`)
      assert(!!e.previewUrl, `Sent email ${idx + 1} has Ethereal preview URL: ${e.previewUrl}`)
    })

    // "Verify that the remaining 2 are delayed into the next available window."
    assert(delayedEmails.length === 2, 'Exactly remaining 2 emails are preserved and delayed into the next window')
    delayedEmails.forEach((e, idx) => {
      assert(
        e.scheduledAt.getTime() > Date.now(),
        `Delayed email ${idx + 1} (${e.recipient}) scheduledAt pushed to future window: ${e.scheduledAt.toISOString()}`
      )
    })

    // "Verify that jobs are not lost."
    assert(
      sentEmails.length + delayedEmails.length === 5,
      'ZERO jobs lost: All 5 emails preserved (3 sent + 2 scheduled)'
    )
    assert(failedEmails.length === 0, 'ZERO emails marked as failed')

    // 6. Verify BullMQ Queue State
    console.log('\n--- Step 6: Verify BullMQ Delayed Queue in Redis ---')
    const delayedJobs = await emailQueue.getDelayed()
    console.log(`BullMQ delayed jobs count: ${delayedJobs.length}`)
    assert(delayedJobs.length >= 2, 'Remaining jobs reside safely in BullMQ Redis delayed set')

    console.log(`\n========================================`)
    console.log(`Results: ${passed} Passed, ${failed} Failed`)
    console.log(`========================================\n`)

    if (failed > 0) process.exit(1)
  } catch (error) {
    console.error('Test execution error:', error)
    process.exit(1)
  } finally {
    if (worker) {
      await worker.close().catch(() => {})
    }
    if (senderWithLimit3?.id) {
      await prisma.sender.delete({ where: { id: senderWithLimit3.id } }).catch(() => {})
    }
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
}

runRateLimitingTests()
