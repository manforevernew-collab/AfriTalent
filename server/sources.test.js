import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRobots, isAllowed } from './robots.js'
import { inScope, mergeBoards, DEFAULT_BOARDS } from './careerBoards.js'
import { parseListing } from './myjobmag.js'
import { employerRows, employerSlug } from './employers.js'

test('robots.txt: longest match wins, Allow beats Disallow on ties, wildcards work', () => {
  const rules = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /job/
Disallow: /*q=*
Allow: /job/public$
Disallow:
`)
  assert.equal(isAllowed(rules, '/jobs/latest-jobs-at-acme'), true)
  assert.equal(isAllowed(rules, '/job/123'), false)
  assert.equal(isAllowed(rules, '/job/public'), true)
  assert.equal(isAllowed(rules, '/job/public/2'), false)
  assert.equal(isAllowed(rules, '/search?q=dev'), false)
  // a group naming our bot takes precedence over *
  const mine = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: AfriTalentJobBot\nAllow: /jobs/', 'afritalentjobbot')
  assert.equal(isAllowed(mine, '/jobs/x'), true)
})

test('global employer boards keep only remote or Africa-based roles', () => {
  const s = 'remote_or_africa'
  assert.equal(inScope(s, { location: 'Lagos, Nigeria' }), true)
  assert.equal(inScope(s, { location: 'Remote, EMEA' }), true)
  assert.equal(inScope(s, { location: 'Remote' }), true)
  assert.equal(inScope(s, { location: 'Remote - US only' }), false)
  assert.equal(inScope(s, { location: 'San Francisco, CA' }), false)
  assert.equal(inScope(s, { location: 'Berlin', remote: true }), true)
  assert.equal(inScope('all', { location: 'San Francisco, CA' }), true)
})

test('board list merges defaults, env and admin rows without duplicates', () => {
  process.env.GREENHOUSE_BOARDS = 'moniepoint,newco'
  const boards = mergeBoards([{ id: 1, provider: 'ashby', slug: 'acme', company_name: 'Acme', scope: 'all', enabled: true }, { id: 2, provider: 'lever', slug: 'paused', company_name: 'P', enabled: false }])
  delete process.env.GREENHOUSE_BOARDS
  const keys = boards.map(b => `${b.provider}:${b.slug}`)
  assert.equal(keys.filter(k => k === 'greenhouse:moniepoint').length, 1)
  assert.ok(keys.includes('greenhouse:newco') && keys.includes('ashby:acme'))
  assert.ok(!keys.includes('lever:paused'))
  assert.equal(boards.find(b => b.slug === 'moniepoint').company, 'Moniepoint', 'default metadata kept')
  assert.ok(DEFAULT_BOARDS.length >= 10)
})

test('MyJobMag listing parser: one job per position, excerpt + link back', () => {
  const html = `<h1>Job Openings at Acme Foods Ltd</h1><div>Posted: Nov 14, 2026 <span>Expires: Not specified</span></div>
  <h2 class="mag-b" id="job111"><a href='/job/sales-rep-acme' class='subjob-title'>Sales Representative</a></h2>
  <ul class="job-key-info"><li><span class="jkey-title">Job Type</span> <span class="jkey-info"><a href="#">Full Time</a></span></li>
  <li><span class="jkey-title">Experience</span> <span class="jkey-info">0 - 1 years</span></li>
  <li><span class="jkey-title">Location</span> <span class="jkey-info"><a href="#">Lagos</a></span></li>
  <li><span class="jkey-title">Job Field</span> <span class="jkey-info"><a href="#">Sales / Marketing</a>&nbsp</span></li></ul>
  <div class="job-details"><p>We are looking for an energetic sales representative to grow our customer base across Lagos.</p></div>
  <h2 class="mag-b" id="job112"><a href='/job/accountant-acme' class='subjob-title'>Accountant</a></h2>
  <ul class="job-key-info"><li><span class="jkey-title">Location</span> <span class="jkey-info">Abuja</span></li></ul>
  <div class="job-details"><p>Prepare monthly accounts.</p></div>
  <h2 id="application-method">Method of Application</h2>`
  const jobs = parseListing(html, 'https://www.myjobmag.com/jobs/job-openings-at-acme-foods-ltd')
  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].company, 'Acme Foods Ltd')
  assert.equal(jobs[0].title, 'Sales Representative')
  assert.equal(jobs[0].location, 'Lagos, Nigeria')
  assert.equal(jobs[0].typeHint, 'Full Time')
  assert.equal(jobs[0].levelHint, 'entry')
  assert.deepEqual(jobs[0].categoryHint[0], 'Sales / Marketing')
  assert.equal(jobs[0].applyUrl, 'https://www.myjobmag.com/job/sales-rep-acme')
  assert.equal(jobs[0].postedAt, '2026-11-14T09:00:00.000Z')
  assert.match(jobs[0].description, /energetic sales representative/)
  assert.match(jobs[0].description, /apply on MyJobMag/)
  assert.equal(jobs[1].location, 'Abuja, Nigeria')
  // expired adverts are skipped entirely
  assert.equal(parseListing(html.replace('Expires: Not specified', 'Expires: Jan 2, 2020'), 'https://www.myjobmag.com/jobs/x').length, 0)
})

test('employer discovery: African hiring employers + career-board companies, generic names skipped', () => {
  const jobs = [
    { company: 'Acme Foods Ltd', location: 'Lagos, Nigeria', category: 'Sales', source: 'MyJobMag', source_url: 'https://x/1' },
    { company: 'Acme Foods Limited', location: 'Abuja, Nigeria', category: 'Finance', source: 'LinkedIn' },
    { company: 'Confidential', location: 'Lagos, Nigeria', category: 'Sales', source: 'MyJobMag' },
    { company: 'Remote Startup Inc', location: 'Remote', category: 'Engineering', source: 'Remotive' },
  ]
  const boards = [{ provider: 'greenhouse', slug: 'moniepoint', company: 'Moniepoint', category: 'Finance & Banking', country: 'Nigeria', website: 'https://moniepoint.com' }]
  const rows = employerRows(jobs, boards, { 'Greenhouse:moniepoint': { ok: true } })
  const names = rows.map(r => r.name)
  assert.deepEqual(names.sort(), ['Acme Foods Ltd', 'Moniepoint'])
  const acme = rows.find(r => r.name === 'Acme Foods Ltd')
  assert.equal(acme.country, 'Nigeria'); assert.equal(acme.city, 'Lagos')
  assert.equal(acme.external_id, `employer:${employerSlug('Acme Foods Ltd')}`)
  assert.equal(rows.find(r => r.name === 'Moniepoint').source, 'Career page')
  assert.equal(employerSlug('Acme Foods Limited'), employerSlug('Acme Foods Ltd'))
})

test('employer discovery: name variants merge with career-board companies; name decides the category', () => {
  const jobs = [
    { company: 'Kuda Technologies Ltd', location: 'Lagos, Nigeria', category: 'Engineering', source: 'MyJobMag' },
    { company: 'Royal College of Nursing Sciences', location: 'Ebonyi, Nigeria', category: 'Engineering', source: 'MyJobMag' },
    { company: 'ReWorks Solutions', location: 'Remote · South Africa, South Africa', category: 'Finance', source: 'Himalayas' },
  ]
  const rows = employerRows(jobs, [{ provider: 'workable', slug: 'kuda', company: 'Kuda', scope: 'all' }], {})
  assert.deepEqual(rows.map(r => r.name).sort(), ['Kuda', 'ReWorks Solutions', 'Royal College of Nursing Sciences'])
  assert.equal(rows.find(r => r.name.startsWith('Royal')).category, 'Education')
  assert.equal(rows.find(r => r.name === 'ReWorks Solutions').location, 'South Africa')
  assert.equal(rows.find(r => r.name === 'Kuda').location, null, 'no invented location')
})
