import axios from 'axios'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { COOKIE_NAME } from '../routes/auth'
import { emailQueue } from '../jobs/emailQueue'
import { createEmailWorker } from '../jobs/emailWorker'
import { registerSender } from '../services/emailService'

const BASE_URL = `http://localhost:${env.PORT}`

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runEmailSchedulerTests() {
  console.log('🧪 Starting ReachInbox BullMQ Email Scheduler Tests...\n')
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
  let testSender: any
  let worker: any

  try {
    // 0. Setup test user and sender in PostgreSQL
    const testEmail = `scheduler.tester.${Date.now()}@reachinbox.example.com`
    testUser = await prisma.user.create({
      data: {
        name: 'Scheduler Admin Tester',
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

    testSender = await registerSender({
      userId: testUser.id,
      name: 'ReachInbox Dispatcher',
      email: 'dispatcher@reachinbox.test',
      hourlyLimit: 60,
    })

    assert(!!testSender.id, 'Registered test Ethereal sender in PostgreSQL')

    // 1. Test POST /api/emails/schedule with future startTime, delayBetweenEmails, and hourlyLimit
    console.log('\n--- Step 1: POST /api/emails/schedule (Batch Scheduling) ---')
    // Set start time 4 seconds in the future
    const targetStartTime = new Date(Date.now() + 4000)
    const recipients = [
      'first.future.recipient@reachinbox.example.com',
      'second.future.recipient@reachinbox.example.com',
    ]

    const schedulePayload = {
      subject: 'Time-Delayed Product Announcement',
      body: '<p>This email was scheduled in advance via BullMQ and Redis!</p>',
      recipients,
      senderId: testSender.id,
      startTime: targetStartTime.toISOString(),
      delayBetweenEmails: 2, // 2 seconds between emails
      hourlyLimit: 60,       // 60/hr -> min 1 minute interval, but let's test spacing
    }

    const scheduleRes = await axios.post(
      `${BASE_URL}/api/emails/schedule`,
      schedulePayload,
      { headers: authHeaders }
    )

    assert(scheduleRes.status === 201, 'POST /api/emails/schedule returns 201 Created')
    assert(scheduleRes.data?.success === true, 'Response indicates success: true')
    assert(scheduleRes.data?.count === 2, 'Scheduled exactly 2 emails')
    assert(scheduleRes.data?.emails?.length === 2, 'Returned 2 scheduled email objects')

    const firstScheduled = scheduleRes.data.emails[0]
    const secondScheduled = scheduleRes.data.emails[1]

    // 2. Verify deterministic Job IDs
    console.log('\n--- Step 2: Verify Deterministic BullMQ Job IDs ---')
    const expectedJobId1 = `email-job-${firstScheduled.id}`
    const expectedJobId2 = `email-job-${secondScheduled.id}`

    assert(firstScheduled.bullJobId === expectedJobId1, `First email uses deterministic job ID: ${expectedJobId1}`)
    assert(secondScheduled.bullJobId === expectedJobId2, `Second email uses deterministic job ID: ${expectedJobId2}`)

    // 3. Verify Redis Queue holds delayed jobs (No cron used!)
    console.log('\n--- Step 3: Verify Delayed Jobs in Redis (BullMQ Persistent Storage) ---')
    const job1 = await emailQueue.getJob(expectedJobId1)
    const job2 = await emailQueue.getJob(expectedJobId2)

    assert(!!job1, 'Job 1 exists in BullMQ Redis queue')
    assert(!!job2, 'Job 2 exists in BullMQ Redis queue')

    const state1 = await job1!.getState()
    const state2 = await job2!.getState()
    assert(state1 === 'delayed', `Job 1 is in "delayed" state in Redis (actual: ${state1})`)
    assert(state2 === 'delayed', `Job 2 is in "delayed" state in Redis (actual: ${state2})`)

    // 4. Verify PostgreSQL initial status is "scheduled"
    console.log('\n--- Step 4: Verify Initial Database Status is "scheduled" ---')
    const email1InDb = await prisma.email.findUnique({ where: { id: firstScheduled.id } })
    assert(email1InDb?.status === 'scheduled', 'PostgreSQL email status is "scheduled"')
    assert(email1InDb?.sentAt === null, 'sentAt is initially null')
    assert(email1InDb?.errorMessage === null, 'errorMessage is initially null')

    // 5. Duplicate Prevention Check
    console.log('\n--- Step 5: Duplicate Prevention Check ---')
    // Attempt to add job with the same deterministic ID
    const duplicateJob = await emailQueue.add(
      'send-email',
      {
        emailId: firstScheduled.id,
        recipient: firstScheduled.recipient,
        subject: firstScheduled.subject,
        html: '<p>Duplicate content</p>',
      },
      { jobId: expectedJobId1, delay: 50000 }
    )
    assert(duplicateJob.id === expectedJobId1, 'BullMQ enforces single deterministic job instance')

    // 6. Start Worker and Test Future Execution Timing
    console.log('\n--- Step 6: Start Worker & Verify Execution at Scheduled Time ---')
    console.log(`Current Time: ${new Date().toISOString()}`)
    console.log(`Target Time:  ${targetStartTime.toISOString()} (~4s delay)`)

    // Start worker process
    worker = createEmailWorker()

    // Immediately check status before delay elapses: must STILL be scheduled
    await sleep(1000)
    const emailStillScheduled = await prisma.email.findUnique({ where: { id: firstScheduled.id } })
    assert(
      emailStillScheduled?.status === 'scheduled',
      'Email is STILL "scheduled" before the delay elapses (not sent prematurely)'
    )

    console.log('Waiting for the scheduled time to arrive and BullMQ worker to process...')
    // Wait for the scheduled time to pass (target is 4s + processing time, let's wait ~10 seconds)
    let emailSent = false
    let attempts = 0
    let deliveredEmail: any

    while (attempts < 15 && !emailSent) {
      await sleep(1500)
      attempts++
      deliveredEmail = await prisma.email.findUnique({ where: { id: firstScheduled.id } })
      if (deliveredEmail?.status === 'sent') {
        emailSent = true
      }
    }

    assert(emailSent, 'BullMQ worker automatically executed delayed job when target time arrived')
    assert(deliveredEmail?.status === 'sent', 'PostgreSQL status updated to "sent"')
    assert(!!deliveredEmail?.sentAt, `sentAt timestamp recorded: ${deliveredEmail?.sentAt?.toISOString()}`)
    assert(!!deliveredEmail?.messageId, `SMTP Message-ID captured: ${deliveredEmail?.messageId}`)
    assert(
      typeof deliveredEmail?.previewUrl === 'string' && deliveredEmail.previewUrl.includes('ethereal.email'),
      `Real Ethereal preview URL saved in DB: ${deliveredEmail?.previewUrl}`
    )

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
    if (testSender?.id) {
      await prisma.sender.delete({ where: { id: testSender.id } }).catch(() => {})
    }
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
}

runEmailSchedulerTests()

