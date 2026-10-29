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

async function run() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5199/login');
  await page.fill('#e', 'demo@agency.com');
  await page.fill('#p', 'Password123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/dashboard', { timeout: 10000 });
  console.log('Landed on URL:', page.url());
  
  await page.waitForSelector('.pj', { timeout: 5000 });
  const projects = await page.locator('.pj').allTextContents();
  console.log('Projects on dashboard:', projects);
  
  const tasks = await page.locator('.tk').allTextContents();
  console.log('Tasks on dashboard:', tasks);

  // Take screenshot of dashboard
  await page.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/27465327-f826-45b1-92f0-cbf56f15afc9/showcase-dashboard.png' });
  console.log('Dashboard screenshot captured!');

  // Navigate to project tasks
  await page.goto('http://localhost:5199/project/project-tasks');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/27465327-f826-45b1-92f0-cbf56f15afc9/showcase-tasks.png' });
  console.log('Tasks screenshot captured!');

  // Navigate to document editor
  await page.goto('http://localhost:5199/workspace/documents');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:/Users/DELL/.gemini/antigravity/brain/27465327-f826-45b1-92f0-cbf56f15afc9/showcase-documents.png' });
  console.log('Documents screenshot captured!');

  await browser.close();
}

run().catch(console.error);
