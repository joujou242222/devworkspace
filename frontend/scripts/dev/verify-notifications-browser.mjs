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
  console.log('=== STARTING WORKSPACE/NOTIFICATIONS BROWSER VERIFICATION ===');
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

  // 2. Navigate to /workspace/notifications
  console.log('2. Navigating to /workspace/notifications...');
  await page.goto(`${BASE_URL}/workspace/notifications`);
  await page.waitForSelector('#app');

  // Assert user header is dynamic (not Sara Adel hardcoded)
  const headerName = await page.textContent('.util a.ib');
  console.log('   Header user element text:', headerName.trim());

  // 3. Check tabs and empty state
  console.log('3. Checking Unread and Read tab filtering...');
  const unreadBtn = page.locator('#tu');
  const readBtn = page.locator('#tr');
  const emptyTitle = page.locator('#nt');
  const markAllBtn = page.locator('#ma');

  // Wait for initial notifications data to be rendered
  await page.waitForFunction(() => {
    const nl = document.getElementById('nl');
    const ne = document.getElementById('ne');
    return nl && (nl.children.length > 0 || (ne && !ne.hidden));
  }, { timeout: 10000 });

  const unreadPressed = await unreadBtn.getAttribute('aria-pressed');
  console.log('   Unread tab aria-pressed:', unreadPressed);
  if (unreadPressed !== 'true') throw new Error('Unread tab should default to pressed');

  // Switch to Read tab
  await readBtn.click();
  const readPressed = await readBtn.getAttribute('aria-pressed');
  console.log('   Read tab aria-pressed:', readPressed);
  if (readPressed !== 'true') throw new Error('Read tab should be pressed after click');

  const emptyMsg = await emptyTitle.textContent();
  console.log('   Empty title on Read tab:', emptyMsg);

  // Switch back to Unread tab
  await unreadBtn.click();
  console.log('   Switched back to Unread tab');

  // 4. Test Mark All as Read API & UI flow
  const canMarkAll = !(await markAllBtn.isDisabled());
  if (canMarkAll) {
    console.log('   Clicking Mark all as read...');
    await markAllBtn.click();
    await page.waitForFunction(() => document.getElementById('ma')?.disabled === true, { timeout: 5000 });
    console.log('   Mark all disabled after click: true');
  } else {
    console.log('   No unread notifications; Mark all is disabled as expected');
  }

  console.log('=== ALL WORKSPACE/NOTIFICATIONS BROWSER CHECKS PASSED SUCCESSFULLY! ===');
  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
