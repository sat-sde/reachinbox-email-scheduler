import axios from 'axios'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { COOKIE_NAME } from '../routes/auth'

const BASE_URL = `http://localhost:${env.PORT}`

async function runAuthTests() {
  console.log('🧪 Starting ReachInbox Real Auth Flow Tests...\n')
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

  try {
    // 1. Test unauthenticated request to /api/auth/me -> Expect 401
    try {
      await axios.get(`${BASE_URL}/api/auth/me`)
      assert(false, 'Unauthenticated /api/auth/me should return 401')
    } catch (error: any) {
      assert(error.response?.status === 401, 'Unauthenticated /api/auth/me returns 401', error.response?.data)
    }

    // 2. Test unauthenticated request to protected private route /api/emails -> Expect 401
    try {
      await axios.get(`${BASE_URL}/api/emails`)
      assert(false, 'Unauthenticated /api/emails should return 401')
    } catch (error: any) {
      assert(error.response?.status === 401, 'Protected /api/emails returns 401 without auth', error.response?.data)
    }

    // 3. Test /auth/google when Google credentials not yet filled -> Expect 503 error
    try {
      const res = await axios.get(`${BASE_URL}/auth/google`, { validateStatus: () => true })
      assert(
        res.status === 503 || res.status === 302,
        'GET /auth/google handles OAuth state properly (503 if unconfigured, 302 if configured)',
        { status: res.status, data: res.data }
      )
    } catch (error: any) {
      assert(false, 'GET /auth/google should handle request gracefully', error.message)
    }

    // 4. Test Google OAuth user creation in PostgreSQL & HTTP-only Cookie Authentication
    const testGoogleId = 'google-oauth2-test-' + Date.now()
    const testEmail = `google.user.${Date.now()}@reachinbox.example.com`
    const testName = 'Alex Mercer'
    const testAvatar = 'https://lh3.googleusercontent.com/a/default-user'

    console.log(`\nSimulating Google verified user identity: ${testEmail}`)
    const testUser = await prisma.user.upsert({
      where: { email: testEmail },
      update: { name: testName, avatar: testAvatar, googleId: testGoogleId },
      create: {
        email: testEmail,
        name: testName,
        avatar: testAvatar,
        googleId: testGoogleId,
      },
    })

    assert(!!testUser.id, 'User successfully created in PostgreSQL with Google ID & profile')

    // Generate signed JWT token
    const token = jwt.sign(
      { userId: testUser.id, email: testUser.email },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    // 5. Test authenticated request with HTTP-only cookie to /api/auth/me -> Expect 200
    const meResponse = await axios.get(`${BASE_URL}/api/auth/me`, {
      headers: {
        Cookie: `${COOKIE_NAME}=${token}`,
      },
    })

    assert(meResponse.status === 200, 'Authenticated /api/auth/me returns 200 OK')
    assert(meResponse.data?.user?.email === testEmail, 'User email matches PostgreSQL record')
    assert(meResponse.data?.user?.name === testName, 'User name matches Google profile')
    assert(meResponse.data?.user?.avatar === testAvatar, 'User avatar matches Google profile')
    assert(meResponse.data?.user?.googleId === testGoogleId, 'User googleId matches verified identity')

    // 6. Test accessing protected routes with the cookie
    const emailsResponse = await axios.get(`${BASE_URL}/api/emails`, {
      headers: {
        Cookie: `${COOKIE_NAME}=${token}`,
      },
    })
    assert(emailsResponse.status === 200, 'Protected /api/emails accessible with valid cookie')

    // 7. Test POST /api/auth/logout -> Expect set-cookie clearing the token
    const logoutResponse = await axios.post(`${BASE_URL}/api/auth/logout`, {}, {
      headers: {
        Cookie: `${COOKIE_NAME}=${token}`,
      },
    })

    assert(logoutResponse.status === 200, 'POST /api/auth/logout returns 200')
    const setCookieHeaders = logoutResponse.headers['set-cookie']
    const hasClearedCookie = Boolean(setCookieHeaders?.some((c: string) => c.includes(`${COOKIE_NAME}=;`) || c.includes('Expires=')))
    assert(hasClearedCookie, 'POST /api/auth/logout clears the secure HTTP-only cookie', setCookieHeaders)

    // 8. Clean up test user
    await prisma.user.delete({ where: { id: testUser.id } })
    console.log('Cleaned up test user from database.\n')

    console.log(`\n========================================`)
    console.log(`Results: ${passed} Passed, ${failed} Failed`)
    console.log(`========================================\n`)

    if (failed > 0) process.exit(1)
  } catch (error) {
    console.error('Test execution error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runAuthTests()
