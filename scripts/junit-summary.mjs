#!/usr/bin/env node
// Turn a JUnit XML report into a Markdown summary for GitHub Actions.
//
// Writes the summary to stdout (so the step log shows it) and, when running in
// Actions, appends it to the job summary ($GITHUB_STEP_SUMMARY). Emits an
// `::error` annotation per failing test so failures surface on the run page.
import { appendFileSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'test-results/junit.xml';

let xml;
try {
  xml = readFileSync(file, 'utf8');
} catch {
  console.log(`No JUnit report found at ${file}`);
  process.exit(0);
}

const decode = (value) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

const attr = (text, name) => {
  const match = text.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decode(match[1]) : '';
};

/** @type {{ name: string, classname: string, time: string, status: string, message: string }[]} */
const cases = [];
const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
let match;
while ((match = caseRe.exec(xml)) !== null) {
  const attrs = match[1];
  const body = match[2] ?? '';
  const failure = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/);
  const skipped = /<skipped\b/.test(body);
  cases.push({
    name: attr(attrs, 'name'),
    classname: attr(attrs, 'classname'),
    time: attr(attrs, 'time'),
    status: failure ? (failure[1] === 'error' ? 'error' : 'failed') : skipped ? 'skipped' : 'passed',
    message: failure ? attr(failure[2], 'message') || decode(failure[3]).trim().split('\n')[0] : '',
  });
}

const passed = cases.filter((c) => c.status === 'passed');
const failed = cases.filter((c) => c.status === 'failed' || c.status === 'error');
const skipped = cases.filter((c) => c.status === 'skipped');
const mark = { passed: '✅', skipped: '⚪', failed: '❌', error: '❌' };

const lines = [];
lines.push(`## ${failed.length ? '❌' : '✅'} Unit tests`);
lines.push('');
lines.push(
  `**${cases.length}** tests · **${passed.length}** passed · **${failed.length}** failed · **${skipped.length}** skipped`,
);
lines.push('');
lines.push('| Test | Result | Time |');
lines.push('|:--|:--|--:|');
for (const testCase of cases) {
  const label = testCase.classname && testCase.classname !== 'test'
    ? `${testCase.classname} › ${testCase.name}`
    : testCase.name;
  const time = testCase.time ? `${(Number(testCase.time) * 1000).toFixed(1)} ms` : '';
  lines.push(`| ${label} | ${mark[testCase.status] ?? ''} ${testCase.status} | ${time} |`);
}

if (failed.length) {
  lines.push('');
  lines.push('### Failures');
  lines.push('');
  for (const testCase of failed) lines.push(`- **${testCase.name}** - ${testCase.message}`);
}

const summary = `${lines.join('\n')}\n`;
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

for (const testCase of failed) {
  const message = testCase.message.replace(/\r?\n/g, ' ').replace(/%/g, '%25').slice(0, 400);
  console.log(`::error title=Test failed: ${testCase.name}::${message}`);
}

process.exit(0);
