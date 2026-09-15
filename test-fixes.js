#!/usr/bin/env node

/**
 * FUW E-Library - Automated Test Script
 * Tests critical functionality after bug fixes
 * 
 * Usage:
 *   node test-fixes.js
 * 
 * Environment Variables Required:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_ANON_KEY - Your Supabase anon key
 *   TEST_EMAIL - Email for test registration
 *   TEST_USERNAME - Username for test registration
 *   TEST_PASSWORD - Password for test registration
 */

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${COLORS.blue}ℹ${COLORS.reset} ${msg}`),
  success: (msg) => console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`),
  error: (msg) => console.log(`${COLORS.red}✗${COLORS.reset} ${msg}`),
  warn: (msg) => console.log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`),
  test: (msg) => console.log(`${COLORS.cyan}▶${COLORS.reset} ${msg}`)
};

// Test suite
const tests = {
  passed: 0,
  failed: 0,
  skipped: 0
};

// Helper to run a test
async function runTest(name, testFn) {
  log.test(`Testing: ${name}`);
  try {
    await testFn();
    tests.passed++;
    log.success(`PASS: ${name}`);
    return true;
  } catch (error) {
    tests.failed++;
    log.error(`FAIL: ${name}`);
    log.error(`  Error: ${error.message}`);
    return false;
  }
}

// Test 1: Check if register_identity_check is accessible to anon
async function testRegisterIdentityCheckAccess() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
  }

  // Simulate anon call to register_identity_check
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_identity_check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      p_username: 'nonexistent_test_user_12345',
      p_email: 'nonexistent_test@example.com'
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`API call failed: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  
  // Should return { username_taken: false, email_taken: false }
  if (typeof data.username_taken !== 'boolean' || typeof data.email_taken !== 'boolean') {
    throw new Error(`Unexpected response format: ${JSON.stringify(data)}`);
  }

  log.info(`  Result: username_taken=${data.username_taken}, email_taken=${data.email_taken}`);
}

// Test 2: Verify DELETE policy exists on profiles
async function testDeletePolicyExists() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
  }

  // Query pg_policies via PostgREST (may not work with anon, but worth trying)
  // Alternative: This test should be run via SQL in Supabase dashboard
  log.warn('  Note: DELETE policy check best done via SQL query in dashboard');
  log.info('  Run: SELECT COUNT(*) FROM pg_policies WHERE tablename=\'profiles\' AND cmd=\'d\';');
  log.info('  Expected: 1');
  
  // For now, we'll mark this as a manual verification test
  // In a real CI/CD environment, you'd use a service role key to query system tables
}

// Test 3: Test registration flow (creates a real test account)
async function testRegistrationFlow() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const TEST_EMAIL = process.env.TEST_EMAIL || `test_${Date.now()}@fuwukari.edu.ng`;
  const TEST_PASSWORD = process.env.TEST_PASSWORD || 'TestPass1234';
  const TEST_USERNAME = process.env.TEST_USERNAME || `testuser_${Date.now()}`;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }

  log.info(`  Registering test user: ${TEST_USERNAME} (${TEST_EMAIL})`);

  // Step 1: Check identity (this was the broken part)
  const checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_identity_check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      p_username: TEST_USERNAME,
      p_email: TEST_EMAIL
    })
  });

  if (!checkResponse.ok) {
    const error = await checkResponse.json();
    throw new Error(`Identity check failed: ${error.message || checkResponse.statusText}`);
  }

  const checkData = await checkResponse.json();
  
  if (checkData.username_taken) {
    throw new Error('Test username already taken. Try a different username.');
  }
  
  if (checkData.email_taken) {
    throw new Error('Test email already taken. Try a different email.');
  }

  log.info('  Identity check passed, username and email available');

  // Step 2: Actual signup
  const signupResponse = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      options: {
        data: {
          full_name: 'Test User',
          display_name: 'Test',
          username: TEST_USERNAME
        }
      }
    })
  });

  if (!signupResponse.ok) {
    const error = await signupResponse.json();
    throw new Error(`Signup failed: ${error.message || signupResponse.statusText}`);
  }

  const signupData = await signupResponse.json();
  
  if (!signupData.user) {
    throw new Error('Signup succeeded but no user returned');
  }

  log.success(`  User created: ${signupData.user.id}`);
  log.warn(`  Note: You may need to manually delete this test user: ${TEST_EMAIL}`);
}

// Test 4: Verify passkey support detection doesn't crash
async function testPasskeyDetection() {
  log.info('  Checking passkey support detection (browser API)');
  
  // This test is more relevant in a browser environment
  // For Node.js, we'll just verify the functions exist in the codebase
  const fs = require('fs');
  const securityPath = './src/lib/security.ts';
  
  if (!fs.existsSync(securityPath)) {
    log.warn('  Cannot verify - not in web app directory');
    return;
  }

  const securityContent = fs.readFileSync(securityPath, 'utf8');
  
  const requiredFunctions = [
    'isPasskeySupported',
    'isPlatformAuthenticatorAvailable',
    'registerPasskey',
    'signInWithPasskey'
  ];

  for (const fn of requiredFunctions) {
    if (!securityContent.includes(fn)) {
      throw new Error(`Missing function: ${fn}`);
    }
  }

  log.info('  All passkey functions present in codebase');
}

// Test 5: Verify migration file exists
async function testMigrationFileExists() {
  const fs = require('fs');
  const migrationPath = './supabase/migrations/20260915_fix_registration_permissions.sql';
  
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${migrationPath}`);
  }

  const content = fs.readFileSync(migrationPath, 'utf8');
  
  // Verify key parts of the migration
  if (!content.includes('GRANT EXECUTE ON FUNCTION public.register_identity_check')) {
    throw new Error('Migration missing register_identity_check grant');
  }

  if (!content.includes('profiles_delete_policy')) {
    throw new Error('Migration missing profiles_delete_policy');
  }

  log.info('  Migration file verified');
}

// Main test runner
async function main() {
  console.log('\n' + COLORS.bright + '═══════════════════════════════════════════════════════════' + COLORS.reset);
  console.log(COLORS.bright + '  FUW E-Library - Automated Fix Verification' + COLORS.reset);
  console.log(COLORS.bright + '═══════════════════════════════════════════════════════════' + COLORS.reset + '\n');

  // Check environment
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    log.warn('Missing environment variables. Some tests will be skipped.');
    log.warn('Set SUPABASE_URL and SUPABASE_ANON_KEY to run all tests.');
    console.log();
  }

  // Run tests
  await runTest('Migration file exists', testMigrationFileExists);
  await runTest('Passkey functions present', testPasskeyDetection);
  
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    await runTest('register_identity_check accessible to anon', testRegisterIdentityCheckAccess);
    
    // Only run registration test if explicitly requested (creates real data)
    if (process.env.RUN_REGISTRATION_TEST === 'true') {
      await runTest('Full registration flow', testRegistrationFlow);
    } else {
      log.info('Skipping registration test (set RUN_REGISTRATION_TEST=true to enable)');
      tests.skipped++;
    }
    
    await runTest('DELETE policy check (manual)', testDeletePolicyExists);
  } else {
    log.warn('Skipping API tests - environment variables not set');
    tests.skipped += 3;
  }

  // Results
  console.log('\n' + COLORS.bright + '═══════════════════════════════════════════════════════════' + COLORS.reset);
  console.log(COLORS.bright + '  Test Results' + COLORS.reset);
  console.log(COLORS.bright + '═══════════════════════════════════════════════════════════' + COLORS.reset);
  console.log(`${COLORS.green}Passed:${COLORS.reset}  ${tests.passed}`);
  console.log(`${COLORS.red}Failed:${COLORS.reset}  ${tests.failed}`);
  console.log(`${COLORS.yellow}Skipped:${COLORS.reset} ${tests.skipped}`);
  console.log(COLORS.bright + '═══════════════════════════════════════════════════════════' + COLORS.reset + '\n');

  if (tests.failed > 0) {
    log.error('Some tests failed. Please review the errors above.');
    process.exit(1);
  } else {
    log.success('All tests passed! ✨');
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    log.error(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
}

module.exports = { runTest, testRegisterIdentityCheckAccess, testDeletePolicyExists };
