import axios from 'axios'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { COOKIE_NAME } from '../routes/auth'
import { sendEmailWithSender, registerSender, createEtherealAccount } from '../services/emailService'
import { decrypt } from '../utils/crypto'

const BASE_URL = `http://localhost:${env.PORT}`

async function runEtherealSMTPTests() {
  console.log('🧪 Starting ReachInbox Ethereal Email SMTP Integration Tests...\n')
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
  let senderA: any
  let senderB: any

  try {
    // 0. Setup a test authenticated user
    const testEmail = `ethereal.tester.${Date.now()}@reachinbox.example.com`
    testUser = await prisma.user.create({
      data: {
        name: 'Ethereal Admin Tester',
        email: testEmail,
      },
    })
    assert(!!testUser.id, 'Test user created in PostgreSQL')

    const token = jwt.sign(
      { userId: testUser.id, email: testUser.email },
      env.JWT_SECRET,
      { expiresIn: '1d' }
    )
    const authHeaders = {
      Cookie: `${COOKIE_NAME}=${token}`,
    }

    // 1. Test POST /api/senders (Create Sender 1 with real Ethereal credentials)
    console.log('\n--- Step 1: Register Sender A (Auto Ethereal Account) ---')
    const createSenderARes = await axios.post(
      `${BASE_URL}/api/senders`,
      {
        name: 'ReachInbox Marketing',
        email: 'marketing@reachinbox.test',
        hourlyLimit: 100,
      },
      { headers: authHeaders }
    )

    assert(createSenderARes.status === 201, 'POST /api/senders returns 201 Created')
    senderA = createSenderARes.data?.sender
    assert(!!senderA?.id, 'Sender A created with UUID')
    assert(senderA?.name === 'ReachInbox Marketing', 'Sender A name preserved')
    assert(!('etherealPass' in senderA), 'Sender A etherealPass is NEVER exposed in API response')

    // 2. Test POST /api/senders (Create Sender 2 with separate custom Ethereal credentials)
    console.log('\n--- Step 2: Register Sender B (Separate Ethereal Account) ---')
    const etherealAccountB = await createEtherealAccount()
    const createSenderBRes = await axios.post(
      `${BASE_URL}/api/senders`,
      {
        name: 'ReachInbox Support',
        email: etherealAccountB.user,
        etherealUser: etherealAccountB.user,
        etherealPass: etherealAccountB.pass,
        host: etherealAccountB.smtp.host,
        port: etherealAccountB.smtp.port,
        hourlyLimit: 75,
      },
      { headers: authHeaders }
    )

    assert(createSenderBRes.status === 201, 'POST /api/senders (Sender B) returns 201')
    senderB = createSenderBRes.data?.sender
    assert(senderB?.id !== senderA?.id, 'Sender A and Sender B have distinct IDs')
    assert(!('etherealPass' in senderB), 'Sender B etherealPass is NOT exposed to frontend')

    // Verify in database that credentials are encrypted
    const senderBInDb = await prisma.sender.findUnique({ where: { id: senderB.id } })
    assert(
      senderBInDb?.etherealPass !== etherealAccountB.pass,
      'Sender B password is encrypted in PostgreSQL (not stored in plain text)'
    )
    assert(
      decrypt(senderBInDb!.etherealPass) === etherealAccountB.pass,
      'Sender B password safely decryptable via AES-256-GCM in memory'
    )

    // 3. Test GET /api/senders
    console.log('\n--- Step 3: GET /api/senders ---')
    const getSendersRes = await axios.get(`${BASE_URL}/api/senders`, { headers: authHeaders })
    assert(getSendersRes.status === 200, 'GET /api/senders returns 200')
    const sendersList = getSendersRes.data?.data
    assert(Array.isArray(sendersList) && sendersList.length >= 2, 'GET /api/senders lists all senders for user')
    const exposedPasswords = sendersList.some((s: any) => 'etherealPass' in s)
    assert(!exposedPasswords, 'GET /api/senders securely excludes all SMTP passwords')

    // 4. Test Sending Real Email via Sender A through Ethereal SMTP
    console.log('\n--- Step 4: Dispatch Real Email via Ethereal SMTP (Sender A) ---')
    const testRecipient = 'client.recipient@reachinbox.example.com'
    const testSubject = `Welcome to ReachInbox! ${Date.now()}`
    const testBody = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
        <h1 style="color: #2563eb;">ReachInbox Email Scheduler</h1>
        <p>This is a real test email dispatched through <strong>Ethereal Email SMTP</strong>.</p>
        <p>Dispatched at: <strong>${new Date().toISOString()}</strong></p>
      </div>
    `

    // Create Email record in DB to track delivery result
    const emailRecord = await prisma.email.create({
      data: {
        userId: testUser.id,
        senderId: senderA.id,
        recipient: testRecipient,
        subject: testSubject,
        body: testBody,
        scheduledAt: new Date(),
        status: 'processing',
      },
    })

    const sendResult = await sendEmailWithSender({
      emailId: emailRecord.id,
      senderId: senderA.id,
      recipient: testRecipient,
      subject: testSubject,
      body: testBody,
    })

    assert(sendResult.success === true, 'SMTP delivery returned success: true')
    assert(!!sendResult.messageId, `SMTP generated Message-ID: ${sendResult.messageId}`)
    assert(
      typeof sendResult.previewUrl === 'string' && sendResult.previewUrl.startsWith('https://ethereal.email/message/'),
      `Ethereal Preview URL successfully generated: ${sendResult.previewUrl}`
    )

    // 5. Verify PostgreSQL stores successful delivery result
    console.log('\n--- Step 5: Verify Delivery Results in PostgreSQL ---')
    const updatedEmailInDb = await prisma.email.findUnique({
      where: { id: emailRecord.id },
    })

    assert(updatedEmailInDb?.status === 'sent', 'PostgreSQL status updated to "sent"')
    assert(!!updatedEmailInDb?.sentAt, 'PostgreSQL sentAt timestamp populated')
    assert(updatedEmailInDb?.messageId === sendResult.messageId, 'PostgreSQL messageId matches SMTP response')
    assert(updatedEmailInDb?.previewUrl === sendResult.previewUrl, 'PostgreSQL previewUrl accurately saved')
    assert(updatedEmailInDb?.errorMessage === null, 'PostgreSQL errorMessage is null for successful delivery')

    // 6. Test Endpoint POST /api/senders/:id/test
    console.log('\n--- Step 6: Test Endpoint POST /api/senders/:id/test ---')
    const endpointTestRes = await axios.post(
      `${BASE_URL}/api/senders/${senderB.id}/test`,
      {
        recipient: 'qa.test@reachinbox.example.com',
        subject: 'Direct Sender B Test Email',
      },
      { headers: authHeaders }
    )

    assert(endpointTestRes.status === 200, 'POST /api/senders/:id/test returns 200 OK')
    assert(endpointTestRes.data?.success === true, 'Endpoint test returned success: true')
    assert(
      typeof endpointTestRes.data?.previewUrl === 'string' &&
        endpointTestRes.data?.previewUrl.includes('ethereal.email'),
      `Sender B preview URL returned from API: ${endpointTestRes.data?.previewUrl}`
    )

    // 7. Verify Failed Delivery Handling in PostgreSQL
    console.log('\n--- Step 7: Verify Failed Delivery Handling in PostgreSQL ---')
    const failedEmailRecord = await prisma.email.create({
      data: {
        userId: testUser.id,
        recipient: 'invalid-domain@thisdoesnotexist-reachinbox-fake.org',
        subject: 'Failing Email Test',
        body: 'Will fail due to invalid SMTP configuration',
        scheduledAt: new Date(),
        status: 'processing',
      },
    })

    // Create a broken sender with wrong host/port
    const brokenSender = await prisma.sender.create({
      data: {
        userId: testUser.id,
        name: 'Broken Sender',
        email: 'broken@reachinbox.test',
        host: '127.0.0.1', // No SMTP service running on port 9999
        port: 9999,
        etherealUser: 'user',
        etherealPass: 'pass',
      },
    })

    try {
      await sendEmailWithSender({
        emailId: failedEmailRecord.id,
        senderId: brokenSender.id,
        recipient: failedEmailRecord.recipient,
        subject: failedEmailRecord.subject,
        body: failedEmailRecord.body,
      })
      assert(false, 'Expected sendEmailWithSender to fail with broken SMTP host')
    } catch (err: any) {
      assert(true, 'sendEmailWithSender caught connection error as expected')
      const failedDbRecord = await prisma.email.findUnique({ where: { id: failedEmailRecord.id } })
      assert(failedDbRecord?.status === 'failed', 'Failed delivery correctly stored as status "failed" in PostgreSQL')
      assert(!!failedDbRecord?.errorMessage, `Error message correctly captured in DB: ${failedDbRecord?.errorMessage?.substring(0, 50)}...`)
    }

    // 8. Test DELETE /api/senders/:id
    console.log('\n--- Step 8: DELETE /api/senders/:id ---')
    const deleteRes = await axios.delete(`${BASE_URL}/api/senders/${brokenSender.id}`, { headers: authHeaders })
    assert(deleteRes.status === 200, 'DELETE /api/senders/:id returns 200')
    const checkDeleted = await prisma.sender.findUnique({ where: { id: brokenSender.id } })
    assert(checkDeleted === null, 'Sender successfully deleted from PostgreSQL')

    console.log(`\n========================================`)
    console.log(`Results: ${passed} Passed, ${failed} Failed`)
    console.log(`========================================\n`)

    if (failed > 0) process.exit(1)
  } catch (error) {
    console.error('Test execution error:', error)
    process.exit(1)
  } finally {
    // Cleanup
    if (senderA?.id) await prisma.sender.delete({ where: { id: senderA.id } }).catch(() => {})
    if (senderB?.id) await prisma.sender.delete({ where: { id: senderB.id } }).catch(() => {})
    if (testUser?.id) await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {})
    await prisma.$disconnect()
  }
}

runEtherealSMTPTests()

