import test from 'node:test'
import assert from 'node:assert/strict'
import { toCompany, socialsFromTags } from './osm.js'
import { pickCities } from './syncBusinesses.js'
import { categoryFromTags, CITIES } from '../../shared/businessTaxonomy.js'

const LAGOS = { name: 'Lagos', country: 'Nigeria' }

test('maps an OSM office to a company row', () => {
  const row = toCompany({
    type: 'node', id: 3453988733, lat: 6.6, lon: 3.35,
    tags: {
      name: 'Libra Reliance Properties', office: 'estate_agent', 'addr:housenumber': '73', 'addr:street': 'Allen Avenue',
      'addr:city': 'Ikeja', phone: '+234 701 188 1000', website: 'property.librareliance.com',
      'contact:facebook': 'librareliance', 'contact:whatsapp': '+234 701 188 1000', note: 'Real estate services',
    },
  }, LAGOS)
  assert.equal(row.external_id, 'osm:node/3453988733')
  assert.equal(row.category, 'Real Estate')
  assert.equal(row.address, '73 Allen Avenue, Ikeja')
  assert.equal(row.city, 'Ikeja')
  assert.equal(row.country, 'Nigeria')
  assert.equal(row.website, 'https://property.librareliance.com/')
  assert.equal(row.socials.facebook, 'https://facebook.com/librareliance')
  assert.equal(row.socials.whatsapp, 'https://wa.me/2347011881000')
  assert.deepEqual(row.services, ['Estate Agent'])
})

test('skips unusable elements and unsafe links', () => {
  assert.equal(toCompany({ type: 'node', id: 1, tags: { name: 'No contact', shop: 'kiosk' } }, LAGOS), null)
  assert.equal(toCompany({ type: 'node', id: 2, tags: { shop: 'bakery', phone: '1' } }, LAGOS), null)
  assert.deepEqual(socialsFromTags({ facebook: 'javascript:alert(1)' }).facebook, 'https://facebook.com/javascript:alert(1)')
  const r = toCompany({ type: 'way', id: 3, center: { lat: 1, lon: 2 }, tags: { name: 'Cafe X', amenity: 'cafe', website: 'javascript:alert(1)', phone: '+254 700 000000', cuisine: 'coffee_shop;pastries', delivery: 'yes' } }, LAGOS)
  assert.ok(r.website === null || r.website.startsWith('https://'), 'never a javascript: URL')
  assert.equal(r.lat, 1)
  assert.ok(r.services.includes('Coffee Shop') && r.services.includes('Delivery'))
})

test('category mapping', () => {
  assert.equal(categoryFromTags({ amenity: 'bank' }), 'Finance & Banking')
  assert.equal(categoryFromTags({ shop: 'hairdresser' }), 'Beauty & Wellness')
  assert.equal(categoryFromTags({ shop: 'shoes' }), 'Retail')
  assert.equal(categoryFromTags({ office: 'it' }), 'Technology')
  assert.equal(categoryFromTags({}), 'Other')
})

test('city rotation covers every city within a week', () => {
  const seen = new Set()
  for (let d = 0; d < 7; d++) pickCities({ perRun: 4, now: new Date(Date.UTC(2026, 10, 1 + d)) }).forEach(c => seen.add(c.name))
  assert.equal(seen.size, CITIES.length)
  assert.deepEqual(pickCities({ only: ['lagos', 'Accra'] }).map(c => c.name), ['Lagos', 'Accra'])
})
