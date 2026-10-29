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

async function testArabicTranslation() {
  console.log('--- STARTING ARABIC TRANSLATION SWAP VERIFICATION ---');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Visit /login
  console.log('1. Navigating to /login...');
  await page.goto('http://localhost:5199/login');

  // Verify Quick Demo Account button is present
  const autoFillBtn = page.locator('#demo-autofill-btn');
  await autoFillBtn.waitFor({ state: 'visible', timeout: 5000 });
  console.log('   Quick Demo Account auto-fill button is present with text:', await autoFillBtn.textContent());

  // Verify language switcher is present
  const langToggle = page.locator('.dw-lang-toggle');
  await langToggle.waitFor({ state: 'visible', timeout: 5000 });
  console.log('   Language toggle pill is visible with text:', await langToggle.textContent());

  // 2. Click language toggle to switch to Arabic
  console.log('2. Clicking language toggle to switch to Arabic...');
  await langToggle.click();
  await page.waitForTimeout(600);

  const lang = await page.evaluate(() => document.documentElement.lang);
  const dir = await page.evaluate(() => document.documentElement.dir);
  console.log(`   HTML attributes after switch: lang="${lang}", dir="${dir}"`);
  if (lang !== 'ar' || dir !== 'rtl') {
    throw new Error(`Expected lang="ar" and dir="rtl", got lang="${lang}", dir="${dir}"`);
  }

  // Check translated text elements
  const headingText = await page.locator('h1').textContent();
  console.log('   Heading 1 text in Arabic:', headingText);

  // Take screenshot of Arabic Login
  await page.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/27465327-f826-45b1-92f0-cbf56f15afc9/showcase-login-arabic.png' });
  console.log('   Saved Arabic login screenshot.');

  // 3. Test Auto-fill in Arabic mode
  console.log('3. Clicking auto-fill in Arabic mode...');
  await autoFillBtn.click();
  const emailVal = await page.locator('#e').inputValue();
  const passVal = await page.locator('#p').inputValue();
  console.log('   Auto-filled values:', { email: emailVal, passLength: passVal.length });

  // 4. Submit login to land on dashboard
  console.log('4. Submitting login...');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/dashboard', { timeout: 10000 });
  console.log('   Landed on dashboard:', page.url());

  await page.waitForTimeout(1000);
  const dashLang = await page.evaluate(() => document.documentElement.lang);
  const dashDir = await page.evaluate(() => document.documentElement.dir);
  console.log(`   Dashboard attributes: lang="${dashLang}", dir="${dashDir}"`);

  // Take screenshot of Arabic Dashboard
  await page.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/27465327-f826-45b1-92f0-cbf56f15afc9/showcase-dashboard-arabic.png' });
  console.log('   Saved Arabic dashboard screenshot.');

  // 5. Test swapping back to English
  console.log('5. Clicking language toggle to switch back to English...');
  const dashLangToggle = page.locator('.dw-lang-toggle');
  await dashLangToggle.click();
  await page.waitForTimeout(600);

  const restoredLang = await page.evaluate(() => document.documentElement.lang);
  const restoredDir = await page.evaluate(() => document.documentElement.dir);
  console.log(`   Restored attributes: lang="${restoredLang}", dir="${restoredDir}"`);
  if (restoredLang !== 'en' || restoredDir !== 'ltr') {
    throw new Error(`Expected lang="en" and dir="ltr", got lang="${restoredLang}", dir="${restoredDir}"`);
  }

  console.log('=== ARABIC TRANSLATION SWAP VERIFICATION PASSED! ===');
  await browser.close();
}

testArabicTranslation().catch(err => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
