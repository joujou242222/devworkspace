import { test, expect } from '@playwright/test';
import { mail, admin, password } from '../phase2/helpers.mjs';
test.afterAll(async () => {
  await admin.end();
});
test('P01–P07/P13/P29/P31: real registration, SMTP proofs, onboarding, team invitation, account/settings and recovery', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const ownerEmail = 'browser-owner-' + crypto.randomUUID() + '@example.test';
  const memberEmail = 'browser-member-' + crypto.randomUUID() + '@example.test';
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('DevWorkspace');
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Browser Owner');
  await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('check your email');
  let link = await mail(ownerEmail, 'Verify your DevWorkspace email');
  await page.goto(link.href);
  await expect(page.getByRole('button', { name: 'Verify email', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Email verified');
  expect(page.url()).not.toContain('token=');
  await page.goto('/login?returnTo=/onboarding');
  await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Organization name', { exact: true }).fill('Browser Agency');
  await page.getByLabel('Description', { exact: true }).fill('Real Phase 2 workflow');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Organization settings', exact: true }),
  ).toBeVisible();
  const settingsUrl = page.url();
  await page.getByLabel('Description', { exact: true }).fill('Saved through real persistence');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'Saved through real persistence',
  );
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByLabel('Invitation email', { exact: true }).fill(memberEmail);
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Invitation queued');
  const inviteLink = await mail(memberEmail, 'DevWorkspace team invitation');
  const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const member = await memberContext.newPage();
  try {
    await member.goto(inviteLink.href);
    await expect(member.getByRole('main').getByRole('alert')).toContainText('Sign in');
    await member.goto('https://localhost:8443/register');
    await member.getByLabel('Display name', { exact: true }).fill('Browser Member');
    await member.getByLabel('Email', { exact: true }).fill(memberEmail);
    await member.getByLabel('Password', { exact: true }).fill(password);
    await member.getByRole('button', { name: 'Register', exact: true }).click();
    await expect(member.getByRole('status')).toContainText('check your email');
    link = await mail(memberEmail, 'Verify your DevWorkspace email');
    await member.goto(link.href);
    await member.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(member.getByRole('status')).toContainText('Email verified');
    await member.goto('https://localhost:8443/login');
    await member.getByLabel('Email', { exact: true }).fill(memberEmail);
    await member.getByLabel('Password', { exact: true }).fill(password);
    await member.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(member).toHaveURL(/\/invitations\/accept$/);
    await member.getByRole('button', { name: 'Review invitation', exact: true }).click();
    await expect(member.getByText('Browser Agency — INTERNAL, MEMBER')).toBeVisible();
    await member.getByRole('button', { name: 'Accept internal membership', exact: true }).click();
    await expect(member).toHaveURL(/\/login\?returnTo=/);
    await member.getByLabel('Email', { exact: true }).fill(memberEmail);
    await member.getByLabel('Password', { exact: true }).fill(password);
    await member.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(member.getByText(/Organization settings are read only/)).toBeVisible();
    await member.goto(settingsUrl.replace('/settings', '/team'));
    await expect(member.getByRole('main').getByRole('alert')).toContainText('administrator');
    await page.goto('https://localhost:8443/account');
    await page.getByLabel('Display name', { exact: true }).fill('Updated Browser Owner');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    await page.reload();
    await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(
      'Updated Browser Owner',
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    await page.goto('/forgot-password');
    await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('check your email');
    link = await mail(ownerEmail, 'Reset your DevWorkspace password');
    await page.goto(link.href);
    await page.getByLabel('New password', { exact: true }).fill(password + 'reset');
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Password reset');
    await page.goto('/login?returnTo=https://hostile.test');
    await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill(password + 'reset');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('https://localhost:8443/account');
  } finally {
    await memberContext.close();
  }
});
