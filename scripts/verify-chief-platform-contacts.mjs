// Real retained service acceptance, restricted to our synthetic organization.
// Bootstrap its independent test account first; never supply an owner session.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = join(root, '.chief-local/platform');
const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
if (manifest.project !== 'chief-platform' || manifest.url !== 'http://localhost:18087' || manifest.status !== 'ready') throw new Error('Expected the independent ready Chief Platform fixture.');
const state = JSON.parse(await readFile(join(runtime, 'acceptance-state.json'), 'utf8'));
if (!state.origins.some(origin => origin.origin === manifest.url && origin.localStorage.some(item => item.name.includes('chiefacceptance')))) throw new Error('Expected the synthetic acceptance state, not an owner profile.');
const evidence = join(root, 'docs/verification/evidence');
await mkdir(evidence, {recursive:true});
const url = `${manifest.url}/workbench/chiefacceptance/contact`;
const checks = [];
const browser = await chromium.launch({headless:true, channel:'chrome'});
try {
  const context = await browser.newContext({storageState:state, viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`${url}/persons`, {waitUntil:'networkidle'});
  await expect(page.getByRole('button',{name:'Person',exact:true}).last()).toBeVisible();
  if (await page.getByRole('button',{name:'Clear filters',exact:true}).isVisible()) await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  const person = page.getByText('Synthetic Ada Chief Fixture',{exact:true});
  await expect(person).toBeVisible();
  await expect(page.getByText('Acceptance Lab Updated',{exact:true})).toBeVisible();
  checks.push('Previously created Person and edited location persist in a fresh browser context');
  // Retained SearchInput collapses to its icon until explicitly opened.
  await page.locator('.searchInput-wrapper').click();
  await page.getByPlaceholder('Search',{exact:true}).fill('NoSuchChiefSyntheticPerson');
  await expect(person).toHaveCount(0);
  await page.getByPlaceholder('Search',{exact:true}).fill('Synthetic Ada');
  await expect(person).toBeVisible();
  await page.getByPlaceholder('Search',{exact:true}).fill('');
  checks.push('Person search excludes nonmatching rows and restores matching row');
  await page.getByRole('button',{name:'Filter',exact:true}).click();
  await page.getByRole('button',{name:'Location',exact:true}).click();
  await page.getByPlaceholder('Location',{exact:true}).fill('NoSuchChiefSyntheticLocation');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(person).toHaveCount(0);
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(person).toBeVisible();
  checks.push('Location filter excludes the row and Clear filters restores it');
  await person.click();
  await expect(page.getByPlaceholder('Location',{exact:true})).toHaveValue('Acceptance Lab Updated');
  const attachment = page.getByText('chief-person-attachment.txt',{exact:true});
  await expect(attachment).toBeVisible();
  const fileUrl = await attachment.getAttribute('href');
  if (!fileUrl || !fileUrl.startsWith('/files/')) throw new Error('Unexpected fixture attachment URL');
  const response = await context.request.get(`${manifest.url}${fileUrl}`);
  expect(response.ok()).toBe(true);
  const body = await response.body();
  expect(body.toString()).toContain('Chief synthetic attachment acceptance. No user data.');
  checks.push('Person attachment persists; retained blob endpoint returns original synthetic contents');
  await page.screenshot({path:join(evidence,'chief-platform-contact-persisted.png')});
  await page.goto(`${url}/companies`, {waitUntil:'networkidle'});
  await page.getByText('Chief Synthetic Company',{exact:true}).click();
  await expect(page.getByText('Synthetic company description for acceptance testing.',{exact:true})).toBeVisible();
  checks.push('Company and rich-text description persist in a fresh browser context');
  await page.screenshot({path:join(evidence,'chief-platform-company-persisted.png')});
  const receipt = {verifiedAt:new Date().toISOString(),scope:'Actual retained Platform Contacts; synthetic Chief Acceptance organization only',project:manifest.project,release:manifest.release,checks,attachment:{bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')},pending:['Employee/Guest lifecycle and multi-user permission checks','Media and meeting functionality','Remaining selected modules']};
  await writeFile(join(evidence,'chief-platform-contacts.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
} finally { await browser.close(); }
