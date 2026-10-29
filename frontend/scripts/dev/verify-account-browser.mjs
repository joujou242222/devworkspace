import { chromium } from '@playwright/test';

async function launchBrowser() {
  const options = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let lastError;
  for (const opt of options) {
    try {
      return await chromium.launch({ ...opt, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const BASE_URL = 'http://localhost:5199';

async function run() {
  console.log('=== STARTING WORKSPACE/ACCOUNT BROWSER VERIFICATION ===');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

  // 1. Login as Owner
  console.log('1. Logging in as existing owner...');
  await page.goto(`${BASE_URL}/login`);
  await page.fill('#e', 'p2-7c1bf40a-8623-4726-9c52-f5db8e088ebd@example.test');
  await page.fill('#p', 'Disposable-phase2-password-123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/dashboard');
  console.log('   [PASS] Owner logged in successfully');

  // 2. Navigate to /workspace/account
  console.log('2. Navigating to /workspace/account...');
  await page.goto(`${BASE_URL}/workspace/account`);
  await page.waitForSelector('#app');

  // Wait for dynamic profile loading
  const dnInput = page.locator('#dn');
  await page.waitForFunction(() => {
    const el = document.getElementById('dn');
    return el && el.value !== 'Sara Adel';
  }, { timeout: 8000 });

  const initialName = await dnInput.inputValue();
  console.log('   Initial display name in field:', initialName);
  if (initialName === 'Sara Adel') {
    throw new Error('Display name field should not be hardcoded to Sara Adel');
  }

  // 3. Update Display Name
  console.log('3. Updating display name...');
  const newName = 'Tariq Updated ' + Date.now().toString().slice(-4);
  await dnInput.fill(newName);
  await page.click('#sv');
  await page.waitForSelector('#ps:not([hidden])');
  const psText = await page.textContent('#ps');
  console.log('   Profile status text:', psText);
  if (!psText.includes('Profile saved')) {
    throw new Error('Expected profile saved message');
  }

  // Check header initials & name updated
  const headerText = await page.textContent('.util a.ib');
  console.log('   Updated header text:', headerText.trim());
  if (!headerText.includes(newName.split(' ')[0])) {
    throw new Error('Header did not update with new name');
  }
  console.log('   [PASS] Display name saved and header updated in DOM');

  // 4. Verify Sessions
  console.log('4. Verifying Sessions table...');
  await page.waitForSelector('#ss tr');
  const sessionRows = await page.locator('#ss tr').all();
  console.log('   Number of sessions listed:', sessionRows.length);
  if (sessionRows.length === 0) throw new Error('Expected at least one session');

  const firstRowText = await sessionRows[0].textContent();
  console.log('   First session row:', firstRowText);
  if (!firstRowText.includes('This device')) {
    throw new Error('Current session should have "This device" tag');
  }

  const firstRowEndBtn = sessionRows[0].locator('button');
  const isCurrentEndDisabled = await firstRowEndBtn.isDisabled();
  console.log('   Current session End button disabled:', isCurrentEndDisabled);
  if (!isCurrentEndDisabled) throw new Error('Current session End button must be disabled');
  console.log('   [PASS] Sessions loaded with current session protected');

  // 5. Verify Notification Preferences
  console.log('5. Verifying Notification Preferences...');
  await page.waitForFunction(() => document.getElementById('a1')?.dataset?.loaded === 'true', { timeout: 8000 });
  const a1 = page.locator('#a1');
  const a2 = page.locator('#a2');
  const a3 = page.locator('#a3');

  const a1Init = await a1.isChecked();
  console.log('   Initial discussions/comments pref:', a1Init);
  // Toggle preference
  await a1.click();
  await page.waitForTimeout(500);
  const a1Toggled = await a1.isChecked();
  console.log('   Toggled discussions/comments pref:', a1Toggled);
  if (a1Toggled === a1Init) throw new Error('Checkbox failed to toggle');
  console.log('   [PASS] Notification preferences loaded and state updated');

  // 6. Test Password Validation
  console.log('6. Testing Password section validation...');
  const pwBtn = page.locator('#pw');
  const peBanner = page.locator('#pe');

  // Empty current password
  await pwBtn.click();
  console.log('   Empty current pass error:', await peBanner.textContent());
  if ((await peBanner.textContent()) !== 'Enter your current password.') {
    throw new Error('Expected "Enter your current password."');
  }

  // Short new password
  await page.fill('#o', 'somepassword');
  await page.fill('#n1', 'short');
  await page.fill('#n2', 'short');
  await pwBtn.click();
  console.log('   Short password error:', await peBanner.textContent());
  if ((await peBanner.textContent()) !== 'Use at least 8 characters.') {
    throw new Error('Expected "Use at least 8 characters."');
  }

  // Password mismatch
  await page.fill('#n1', 'password123');
  await page.fill('#n2', 'password999');
  await pwBtn.click();
  console.log('   Mismatch password error:', await peBanner.textContent());
  if ((await peBanner.textContent()) !== 'Passwords don’t match.') {
    throw new Error('Expected "Passwords don’t match."');
  }

  // Wrong current password
  await page.fill('#o', 'wrongcurrentpass123');
  await page.fill('#n1', 'newpassword123');
  await page.fill('#n2', 'newpassword123');
  await pwBtn.click();
  await page.waitForTimeout(500);
  console.log('   Wrong current pass error:', await peBanner.textContent());
  if (!(await peBanner.textContent()).includes('Current password is incorrect')) {
    throw new Error('Expected "Current password is incorrect."');
  }
  console.log('   [PASS] Client & server password validations passed');

  // 7. Test REAUTHENTICATE handling with route interception
  console.log('7. Testing REAUTHENTICATE link rendering for password change...');
  await page.route('**/api/v1/me/password', route => {
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'urn:devworkspace:problem:REAUTHENTICATE',
        code: 'REAUTHENTICATE',
        message: 'Recent authentication required'
      })
    });
  });

  await page.fill('#o', 'Disposable-phase2-password-123!');
  await page.fill('#n1', 'NewDisposable-password-123!');
  await page.fill('#n2', 'NewDisposable-password-123!');
  await pwBtn.click();
  await page.waitForTimeout(500);

  const reauthHtml = await peBanner.innerHTML();
  console.log('   Reauthenticate rendered HTML:', reauthHtml);
  if (!reauthHtml.includes('For security') || !reauthHtml.includes('/login?returnTo=') || !reauthHtml.includes('change your password')) {
    throw new Error('Expected reauth family message with link');
  }
  console.log('   [PASS] Reauthenticate message family correctly rendered for password change');

  // 8. Test real password change success path with fresh session
  console.log('8. Testing real password change success path...');
  await page.unroute('**/api/v1/me/password');
  await page.fill('#o', 'Disposable-phase2-password-123!');
  await page.fill('#n1', 'UpdatedFresh-password-456!');
  await page.fill('#n2', 'UpdatedFresh-password-456!');
  await pwBtn.click();
  await page.waitForSelector('#po:not([hidden])', { timeout: 8000 });
  const successText = await page.textContent('#po');
  console.log('   Password update success message:', successText);
  if (!successText?.includes('Password updated.')) {
    throw new Error('Expected "Password updated.", got: ' + successText);
  }
  console.log('   [PASS] Real password change succeeded with fresh session');

  // Revert password back for shared test seed stability
  await page.fill('#o', 'UpdatedFresh-password-456!');
  await page.fill('#n1', 'Disposable-phase2-password-123!');
  await page.fill('#n2', 'Disposable-phase2-password-123!');
  await pwBtn.click();
  await page.waitForTimeout(500);

  console.log('=== ALL WORKSPACE/ACCOUNT BROWSER CHECKS PASSED SUCCESSFULLY! ===');
  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
