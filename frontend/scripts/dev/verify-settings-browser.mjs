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
  console.log('=== STARTING WORKSPACE/SETTINGS BROWSER VERIFICATION ===');
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

  // 2. Navigate to /workspace/settings
  console.log('2. Navigating to /workspace/settings...');
  await page.goto(`${BASE_URL}/workspace/settings`);
  await page.waitForSelector('#app');

  // Wait for dynamic org loading
  const cnInput = page.locator('#cn');
  await page.waitForFunction(() => {
    const el = document.getElementById('cn');
    return el && el.value !== 'Studio Nour';
  }, { timeout: 8000 });

  const initialOrgName = await cnInput.inputValue();
  console.log('   Initial org name in field:', initialOrgName);
  if (initialOrgName === 'Studio Nour') {
    throw new Error('Org name should not be hardcoded to Studio Nour');
  }

  // 3. Update Org Name
  console.log('3. Updating company name...');
  const newOrgName = 'Agency Settings Test ' + Date.now().toString().slice(-4);
  await cnInput.fill(newOrgName);
  await page.click('#sv');
  await page.waitForSelector('#ok:not([hidden])');
  const okText = await page.textContent('#ok');
  console.log('   Settings status text:', okText);
  if (!okText.includes('Settings saved')) {
    throw new Error('Expected "Settings saved." message');
  }

  // Check confirmation prompt label updated
  const confirmLabelText = await page.textContent('label[for=tc] b');
  console.log('   Confirmation label updated text:', confirmLabelText);
  if (confirmLabelText !== newOrgName) {
    throw new Error('Confirmation label did not update with new org name');
  }
  console.log('   [PASS] Org settings saved and confirmation label updated');

  // 4. Verify Danger Zone for Owner
  console.log('4. Verifying Danger zone for Owner...');
  const dangerSec = page.locator('section.danger');
  const isDangerVisible = await dangerSec.isVisible();
  console.log('   Danger zone visible for owner:', isDangerVisible);
  if (!isDangerVisible) throw new Error('Danger zone must be visible for Owner');

  // Check Transfer Ownership confirmation input
  const toSelect = page.locator('#to');
  const tcInput = page.locator('#tc');
  const tbBtn = page.locator('#tb');

  // Ensure there's a selected member in #to for the test
  const optionsCount = await toSelect.locator('option').count();
  console.log('   Number of members in #to select:', optionsCount);
  if (optionsCount === 0 || (await toSelect.inputValue()) === '') {
    await page.evaluate(() => {
      const to = document.getElementById('to');
      if (to) {
        to.innerHTML = '<option value="mock-membership-id-123" selected>Omar Hassan (omar@example.com)</option>';
        to.disabled = false;
      }
    });
  }

  const initialDisabled = await tbBtn.isDisabled();
  console.log('   Transfer button initially disabled:', initialDisabled);
  if (!initialDisabled) throw new Error('Transfer button must be disabled initially');

  // Partial match
  await tcInput.fill('Wrong name');
  if (!(await tbBtn.isDisabled())) throw new Error('Transfer button should be disabled for wrong name');

  // Exact match
  await tcInput.fill(newOrgName);
  const isEnabled = await tbBtn.isEnabled();
  console.log('   Transfer button enabled on exact match:', isEnabled);
  if (!isEnabled) throw new Error('Transfer button must be enabled when exact org name is entered');
  console.log('   [PASS] Danger zone confirmation input behaves correctly');

  // 5. Test REAUTHENTICATE handling on ownership transfer with route interception
  console.log('5. Testing REAUTHENTICATE message family for ownership transfer...');
  await page.route('**/api/v1/organizations/*/ownership', route => {
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

  page.on('dialog', async dialog => {
    console.log('   Confirmation dialog appeared:', dialog.message());
    await dialog.accept();
  });

  await tbBtn.click();
  await page.waitForTimeout(300);

  // If H.askConfirm rendered custom dialog
  const dialogSubmit = page.locator('dialog form button[type="submit"]');
  if (await dialogSubmit.isVisible()) {
    console.log('   Confirming custom dialog...');
    await dialogSubmit.click();
  }
  await page.waitForTimeout(500);

  const reBanner = page.locator('#re');
  const reHtml = await reBanner.innerHTML();
  console.log('   Reauthenticate rendered HTML in #re:', reHtml);
  if (!reHtml.includes('Sign in again before transferring ownership')) {
    throw new Error('Expected design reauth element to be shown');
  }
  console.log('   [PASS] Design reauthenticate element revealed for ownership transfer');

  await browser.close();
  console.log('=== ALL WORKSPACE/SETTINGS BROWSER CHECKS PASSED SUCCESSFULLY! ===');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
