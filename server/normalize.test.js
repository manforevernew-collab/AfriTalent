import test from 'node:test'
import assert from 'node:assert/strict'
import {
  htmlToText, detectVisaSponsorship, detectWorkMode, normalizeType, detectLevel,
  detectCategory, formatSalary, buildJob, toIso,
} from './normalize.js'

test('htmlToText strips (double-escaped) html and keeps structure', () => {
  assert.equal(htmlToText('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;'), 'Hello & welcome\n• One')
  assert.equal(htmlToText('<p>A</p><script>x()</script><p>B</p>'), 'A\nB')
  assert.equal(htmlToText('<h3>Skills</h3>\n<ul>\n  <li>\n<p>Tamil</p>\n</li>\n  <li><p>English</p></li>\n</ul>'), 'Skills\n• Tamil\n• English')
  assert.equal(htmlToText('Line one\nLine two'), 'Line one\nLine two')
})

test('visa sponsorship detection honours negations', () => {
  assert.equal(detectVisaSponsorship('We offer visa sponsorship and relocation support.'), true)
  assert.equal(detectVisaSponsorship('Relocation assistance is provided including visa sponsorship.'), true)
  assert.equal(detectVisaSponsorship('We are unable to offer visa sponsorship for this role.'), false)
  assert.equal(detectVisaSponsorship('Candidates must be authorised to work without sponsorship.'), false)
  assert.equal(detectVisaSponsorship('Great benefits and remote culture.'), false)
})

test('work mode detection', () => {
  assert.equal(detectWorkMode({ remoteFlag: true, location: 'Berlin' }), 'Remote')
  assert.equal(detectWorkMode({ location: 'Lagos (Hybrid)' }), 'Hybrid')
  assert.equal(detectWorkMode({ location: 'Nairobi, Kenya', remoteFlag: false }), 'On-site')
  assert.equal(detectWorkMode({ location: 'Anywhere in the World' }), 'Remote')
  assert.equal(detectWorkMode({ hint: 'on-site', location: 'Remote friendly office' }), 'On-site')
})

test('type, level and category normalisation', () => {
  assert.equal(normalizeType('full_time'), 'Full-time')
  assert.equal(normalizeType(['Part-Time']), 'Part-time')
  assert.equal(normalizeType('', 'Marketing Intern'), 'Internship')
  assert.equal(normalizeType('Contractor'), 'Contract')
  assert.equal(detectLevel('Graduate Software Engineer'), 'Entry')
  assert.equal(detectLevel('Senior Backend Engineer'), 'Senior')
  assert.equal(detectLevel('VP of Sales'), 'Executive')
  assert.equal(detectLevel('Accountant'), 'Mid')
  assert.equal(detectCategory('Software Development'), 'Engineering')
  assert.equal(detectCategory(null, 'Customer Success Manager'), 'Customer Support')
  assert.equal(detectCategory(null, 'Underwater basket weaver'), 'Other')
})

test('salary formatting', () => {
  assert.equal(formatSalary(50000, 80000, 'USD', 'year'), '$50k – $80k/yr')
  assert.equal(formatSalary(0, 0), null)
  assert.equal(formatSalary(30, null, 'GBP', 'hour'), '£30/hr')
})

test('toIso treats zone-less timestamps as UTC and never returns future dates', () => {
  assert.equal(toIso('2024-01-02T03:04:05'), '2024-01-02T03:04:05.000Z')
  assert.equal(toIso(1704164645), '2024-01-02T03:04:05.000Z')
  assert.ok(new Date(toIso('2999-01-01')).getTime() <= Date.now())
})

test('buildJob produces a complete row and rejects unusable records', () => {
  const row = buildJob({
    source: 'We Work Remotely', externalId: 'acme-dev', title: 'Junior React Developer',
    company: 'Acme', location: 'Anywhere', remote: true, typeHint: 'Full-Time',
    description: '<p>Visa sponsorship available.</p>', tags: ['React', 'react', 'TypeScript'],
    applyUrl: 'https://example.com/apply', postedAt: '2024-05-01T10:00:00Z',
  })
  assert.equal(row.external_id, 'we-work-remotely:acme-dev')
  assert.equal(row.work_mode, 'Remote')
  assert.equal(row.visa_sponsorship, true)
  assert.equal(row.experience_level, 'Entry')
  assert.equal(row.category, 'Engineering')
  assert.deepEqual(row.required_skills, ['React', 'TypeScript'])
  assert.equal(row.apply_url, 'https://example.com/apply')
  assert.equal(buildJob({ source: 'X', externalId: '1', title: 'No link' }), null)
  assert.equal(buildJob({ source: 'X', externalId: '1', title: 'Bad link', applyUrl: 'javascript:alert(1)' }), null)
})
