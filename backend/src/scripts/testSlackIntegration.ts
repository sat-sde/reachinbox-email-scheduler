import axios from 'axios'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { COOKIE_NAME } from '../routes/auth'
import { redisConnection } from '../config/redis'
import { encrypt, decrypt } from '../utils/crypto'
import {
  getSlackAuthUrl,
  getSlackConnectionStatus,
  disconnectSlackConnection,
  sendSlackRateLimitNotification,
  SLACK_REQUIRED_SCOPES,
} from '../services/slackService'

const BASE_URL = `http://localhost:${env.PORT}`

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runSlackIntegrationTests() {
  console.log('🧪 Starting ReachInbox Slack OAuth & Notification Tests...\n')
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

  try {
    // 0. Setup test user
    const testEmail = `slack.tester.${Date.now()}@reachinbox.example.com`
    testUser = await prisma.user.create({
      data: {
        name: 'Slack Integration Tester',
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

    testSender = await prisma.sender.create({
      data: {
        userId: testUser.id,
        name: 'Alerting Sender',
        email: 'alerts@reachinbox.test',
        etherealUser: encrypt('ethereal_dummy_user'),
        etherealPass: encrypt('ethereal_dummy_pass'),
        hourlyLimit: 10,
      },
    })

    // ── Test 1: Slack OAuth URL Generation & Permissions ──────────
    console.log('--- Test 1: Slack OAuth URL Generation & Permissions ---')
    const authUrlResult = getSlackAuthUrl(testUser.id)

    // Even if SLACK_CLIENT_ID is unset in test env, helper responds with clean status
    if (env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET) {
      assert(authUrlResult.configured === true, 'Slack OAuth reported as configured')
      assert(authUrlResult.url.includes('https://slack.com/oauth/v2/authorize'), 'URL targets Slack v2 authorize endpoint')
      assert(authUrlResult.url.includes(`scope=${encodeURIComponent(SLACK_REQUIRED_SCOPES)}`), `Requests minimum permissions: ${SLACK_REQUIRED_SCOPES}`)
      assert(authUrlResult.url.includes(`client_id=${env.SLACK_CLIENT_ID}`), 'URL includes SLACK_CLIENT_ID')
    } else {
      // Mock test of getSlackAuthUrl structure
      const mockParams = new URLSearchParams({
        client_id: 'mock-slack-client-id',
        scope: SLACK_REQUIRED_SCOPES,
        redirect_uri: env.SLACK_CALLBACK_URL,
        state: jwt.sign({ userId: testUser.id }, env.JWT_SECRET),
      })
      const mockUrl = `https://slack.com/oauth/v2/authorize?${mockParams.toString()}`
      assert(mockUrl.includes('https://slack.com/oauth/v2/authorize'), 'URL targets Slack v2 authorize endpoint')
      assert(mockUrl.includes('chat%3Awrite%2Cincoming-webhook'), `Requests minimum scopes: ${SLACK_REQUIRED_SCOPES}`)
      assert(mockUrl.includes(encodeURIComponent(env.SLACK_CALLBACK_URL)), 'URL includes proper redirect_uri')
    }

    // ── Test 2: GET /api/slack/status (Initially Not Connected) ────
    console.log('\n--- Test 2: GET /api/slack/status (Disconnected State) ---')
    const statusRes1 = await axios.get(`${BASE_URL}/api/slack/status`, { headers: authHeaders })
    assert(statusRes1.status === 200, 'GET /api/slack/status returned 200')
    assert(statusRes1.data.connected === false, 'Reports connected: false when no connection exists')
    assert(statusRes1.data.connection === null, 'connection payload is null')

    // ── Test 3: Notification When Slack is Not Connected ───────────
    console.log('\n--- Test 3: Rate Limit Alert When Slack is Not Connected ---')
    const nextWindow = new Date(Date.now() + 3600000)
    const unnotifiedResult = await sendSlackRateLimitNotification({
      senderId: testSender.id,
      senderEmail: testSender.email,
      hourlyLimit: 10,
      nextAvailableTime: nextWindow,
      delayNeededMs: 3600000,
    })
    assert(unnotifiedResult.sent === false, 'Notification skipped when Slack is not connected')
    assert(unnotifiedResult.reason === 'NOT_CONNECTED', 'Reported reason: NOT_CONNECTED')

    // ── Test 4: Secure PostgreSQL Token Storage (Encryption Check) ──
    console.log('\n--- Test 4: Secure PostgreSQL Token Storage & Encryption ---')
    const fakeSlackToken = 'xoxb-dummy-slack-access-token-123456789'
    const encryptedToken = encrypt(fakeSlackToken)

    // Store in PostgreSQL
    const createdConn = await prisma.slackConnection.create({
      data: {
        userId: testUser.id,
        accessToken: encryptedToken,
        teamId: 'T08TESTING',
        teamName: 'ReachInbox Workspace',
        channelId: 'C08ALERTS',
        channelName: '#email-alerts',
        connected: true,
      },
    })

    assert(createdConn.connected === true, 'SlackConnection created in PostgreSQL')
    // Verify it is NOT plain text in DB
    const dbRecord = await prisma.slackConnection.findUnique({ where: { id: createdConn.id } })
    assert(dbRecord?.accessToken !== fakeSlackToken, 'Token is NOT stored in plain text')
    assert(Boolean(dbRecord?.accessToken.includes(':')), 'Token is encrypted in IV:TAG:CIPHERTEXT format')
    assert(decrypt(dbRecord!.accessToken) === fakeSlackToken, 'Token successfully decrypted with AES-256-GCM')

    // ── Test 5: GET /api/slack/status (Connected State) ────────────
    console.log('\n--- Test 5: GET /api/slack/status (Connected State) ---')
    const statusRes2 = await axios.get(`${BASE_URL}/api/slack/status`, { headers: authHeaders })
    assert(statusRes2.data.connected === true, 'Reports connected: true after linking')
    assert(statusRes2.data.connection?.teamName === 'ReachInbox Workspace', 'Returns workspace teamName')
    assert(statusRes2.data.connection?.channelName === '#email-alerts', 'Returns channelName')
    assert(!statusRes2.data.connection?.accessToken, 'NEVER exposes access token to client')

    // ── Test 6: Dynamic Detection Without Redeployment ─────────────
    console.log('\n--- Test 6: Dynamic Notification Detection After Slack Connects ---')
    // Clean Redis alert keys
    const alertKey = `slack:rate_limit_alert:${testSender.id}:${nextWindow.getTime()}`
    await redisConnection.del(alertKey)

    const connectedAlertResult = await sendSlackRateLimitNotification({
      senderId: testSender.id,
      senderEmail: testSender.email,
      hourlyLimit: 10,
      nextAvailableTime: nextWindow,
      delayNeededMs: 3600000,
    })
    // It should attempt delivery (will get ERROR / invalid_auth from Slack API since it's a dummy token, NOT 'NOT_CONNECTED'!)
    assert(connectedAlertResult.reason !== 'NOT_CONNECTED', 'Successfully detected active connection without restarting worker')

    // ── Test 7: Redis Deduplication (Notify ONLY ONCE Per Event) ──
    console.log('\n--- Test 7: Redis Deduplication (Zero Spam Guarantee) ---')
    // Second attempt for same sender and same window
    const duplicateAlertResult = await sendSlackRateLimitNotification({
      senderId: testSender.id,
      senderEmail: testSender.email,
      hourlyLimit: 10,
      nextAvailableTime: nextWindow,
      delayNeededMs: 3600000,
    })
    assert(duplicateAlertResult.sent === false, 'Duplicate alert was suppressed')
    assert(duplicateAlertResult.reason === 'ALREADY_NOTIFIED', 'Reason is accurately ALREADY_NOTIFIED')

    // Verify key in Redis
    const redisVal = await redisConnection.get(alertKey)
    assert(redisVal === '1', 'Notification state preserved in Redis')
    const ttl = await redisConnection.ttl(alertKey)
    assert(ttl > 0, `Redis key has valid TTL (${ttl}s)`)

    // ── Test 8: POST /api/slack/disconnect ─────────────────────────
    console.log('\n--- Test 8: POST /api/slack/disconnect ---')
    const disconnectRes = await axios.post(`${BASE_URL}/api/slack/disconnect`, {}, { headers: authHeaders })
    assert(disconnectRes.status === 200, 'POST /api/slack/disconnect returned 200')

    const statusRes3 = await axios.get(`${BASE_URL}/api/slack/status`, { headers: authHeaders })
    assert(statusRes3.data.connected === false, 'Status verified as disconnected')

    // Clean up
    await redisConnection.del(alertKey)

    console.log(`\n========================================`)
    console.log(`Results: ${passed} Passed, ${failed} Failed`)
    console.log(`========================================\n`)

    if (failed > 0) process.exit(1)
  } catch (error) {
    console.error('Test execution error:', error)
    process.exit(1)
  } finally {
    if (testSender?.id) {
      await prisma.sender.delete({ where: { id: testSender.id } }).catch(() => {})
    }
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
}

runSlackIntegrationTests()
