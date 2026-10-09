// Uses only the synthetic Chief Acceptance organization created for acceptance.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = join(root, '.chief-local/platform');
const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
if (manifest.project !== 'chief-platform' || manifest.url !== 'http://localhost:18087' || manifest.status !== 'ready') throw new Error('Expected the independent ready Chief Platform fixture.');
const state = JSON.parse(await readFile(join(runtime, 'acceptance-state.json'), 'utf8'));
if (!state.origins.some(origin => origin.origin === manifest.url && origin.localStorage.some(item => item.name.includes('chiefacceptance')))) throw new Error('Expected synthetic acceptance state.');
const evidence = join(root, 'docs/verification/evidence');
await mkdir(evidence, {recursive:true});
const cardUrl = `${manifest.url}/workbench/chiefacceptance/card/6ac6aa185b1567fb393c76f2`;
const checks = [];
const browser = await chromium.launch({headless:true, channel:'chrome'});
try {
  const context = await browser.newContext({storageState:state, viewport:{width:1600,height:1000}});
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(cardUrl, {waitUntil:'networkidle'});
  const editor = page.locator('.ProseMirror.flex-grow');
  const assertCard = async () => {
    expect(page.url()).toBe(cardUrl);
    await expect(page.getByPlaceholder('Card',{exact:true})).toHaveValue('Chief Synthetic Card');
    await expect(editor).toContainText('Chief synthetic editable card content.');
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('table')).toContainText('Synthetic table cell');
  };
  await assertCard();
  checks.push('Card title, editable rich body and inserted table persist in a fresh browser context');
  const calendarButton = page.locator('button.app.small').filter({has:page.locator('use[href$="#calendar"]')});
  const officeButton = page.locator('button.app.small').filter({has:page.locator('use[href$="#office"]')});
  if (!(await page.locator('.now-line').isVisible())) await calendarButton.click();
  const nowLine = page.locator('.now-line');
  await expect(nowLine).toBeVisible();
  await assertCard();
  const before = {label:await nowLine.getAttribute('data-now'), top:await nowLine.evaluate(n=>n.style.top)};
  // Advance Date only, leaving real service connections and timer scheduling alone.
  await page.clock.setFixedTime(new Date(Date.now()+120000));
  await expect.poll(()=>nowLine.getAttribute('data-now')).not.toBe(before.label);
  await expect.poll(()=>nowLine.evaluate(n=>n.style.top)).not.toBe(before.top);
  const after = {label:await nowLine.getAttribute('data-now'), top:await nowLine.evaluate(n=>n.style.top)};
  checks.push('Current-time line updates its label and vertical position without navigation under a controlled two-minute clock advance');
  const eventTitle = 'Chief Synthetic Calendar Event';
  if (!(await page.getByText(eventTitle,{exact:true}).isVisible())) {
    await page.locator('.empty-cell').nth(15).click();
    await expect(page.getByPlaceholder('Event title',{exact:true})).toBeVisible();
    await page.getByPlaceholder('Event title',{exact:true}).fill(eventTitle);
    await page.getByRole('button',{name:'Create',exact:true}).click();
  }
  await expect(page.getByText(eventTitle,{exact:true})).toBeVisible();
  await assertCard();
  await page.screenshot({path:join(evidence,'chief-platform-card-calendar.png')});
  await officeButton.click();
  await expect(nowLine).toHaveCount(0);
  await assertCard();
  await page.screenshot({path:join(evidence,'chief-platform-card-office.png')});
  checks.push('Switching the companion from Calendar to compact Office preserves the open Card and its rich content');
  await officeButton.click();
  await expect(nowLine).toHaveCount(0);
  await assertCard();
  await calendarButton.click();
  await expect(page.getByText(eventTitle,{exact:true})).toBeVisible();
  checks.push('Closing and reopening the companion keeps the main Card open');
  await context.close();
  const fresh = await browser.newContext({storageState:state, viewport:{width:1600,height:1000}});
  const persisted = await fresh.newPage();
  await persisted.goto(cardUrl,{waitUntil:'networkidle'});
  if (!(await persisted.locator('.now-line').isVisible())) await persisted.locator('button.app.small').filter({has:persisted.locator('use[href$="#calendar"]')}).click();
  await expect(persisted.getByText(eventTitle,{exact:true})).toBeVisible();
  checks.push('Event created by clicking a calendar time slot persists in a second fresh browser context');
  const receipt = {verifiedAt:new Date().toISOString(),scope:'Actual retained Cards and companion; synthetic organization only',checks,clock:{before,after},pending:['Spaces and Types editing','Card attachments, mentions, emoji and templates','Meeting admission, shared presence and AV','Recording and follow-up workflows']};
  await writeFile(join(evidence,'chief-platform-cards.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
} finally { await browser.close(); }
