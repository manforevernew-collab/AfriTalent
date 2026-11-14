import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMrz, mrzCheckDigit, validateIdNumber, parseSaId, parseEgId, nameSimilarity, ageOn, luhnValid } from './idRules.js'

// ICAO Doc 9303 published specimen MRZs (fictional "Utopia" documents)
const TD3 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10'
const TD1 = 'I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<'

test('ICAO 9303 check digits', () => {
  assert.equal(mrzCheckDigit('L898902C3'), 6)
  assert.equal(mrzCheckDigit('740812'), 2)
  assert.equal(mrzCheckDigit('120415'), 9)
})

test('valid passport MRZ (TD3) parses', () => {
  const r = parseMrz(TD3)
  assert.equal(r.valid, true, r.errors.join(', '))
  assert.equal(r.documentNumber, 'L898902C3')
  assert.equal(r.dob, '1974-08-12')
  assert.equal(r.expiry, '2012-04-15')
  assert.equal(r.surname, 'ERIKSSON')
  assert.equal(r.givenNames, 'ANNA MARIA')
})

test('valid ID card MRZ (TD1) parses', () => {
  const r = parseMrz(TD1)
  assert.equal(r.valid, true, r.errors.join(', '))
  assert.equal(r.documentNumber, 'D23145890')
})

test('tampered MRZ is caught', () => {
  // change one digit of the document number but keep the old check digit
  const forged = TD3.replace('L898902C36', 'L898903C36')
  const r = parseMrz(forged)
  assert.equal(r.valid, false)
  assert.ok(r.errors.some(e => /Document number/.test(e)))
  // edited birth date
  assert.equal(parseMrz(TD3.replace('7408122', '7508122')).valid, false)
  assert.equal(parseMrz('garbage').valid, false)
})

test('South African ID: Luhn + encoded birth date', () => {
  const ok = parseSaId('8001015009087')
  assert.equal(ok.valid, true)
  assert.equal(ok.dob, '1980-01-01')
  assert.equal(ok.sex, 'M')
  assert.equal(parseSaId('8001015009088').valid, false) // wrong check digit
  assert.equal(parseSaId('8013015009087').valid, false) // month 13
  assert.equal(luhnValid('79927398713'), true)
})

test('Egyptian ID structure', () => {
  const ok = parseEgId('29001011234567')
  assert.equal(ok.valid, true)
  assert.equal(ok.dob, '1990-01-01')
  assert.equal(parseEgId('29002301234567').valid, false) // 30 Feb
  assert.equal(parseEgId('29001019934567').valid, false) // governorate 99
})

test('validateIdNumber strict vs pattern rules', () => {
  assert.equal(validateIdNumber('NG', 'nin', '123 4567 8901').valid, true)
  assert.deepEqual([validateIdNumber('NG', 'nin', '12345').valid, validateIdNumber('NG', 'nin', '12345').strict], [false, true])
  assert.equal(validateIdNumber('GH', 'ghana_card', 'GHA-123456789-0').valid, true)
  assert.equal(validateIdNumber('GH', 'ghana_card', 'GHA-12345-0').valid, false)
  const pp = validateIdNumber('NG', 'passport', '12')
  assert.equal(pp.valid, false)
  assert.equal(pp.strict, false)
  assert.equal(validateIdNumber('NG', 'passport', 'A12345678').valid, true)
  assert.equal(validateIdNumber('TZ', 'tz_nida', '19900101123456789012').valid, true)
  assert.equal(validateIdNumber('RW', 'rw_national_id', '1199080012345678').valid, true)
})

test('name similarity and age', () => {
  assert.equal(nameSimilarity('Chioma Okafor', 'OKAFOR CHIOMA ADA'), 1)
  assert.equal(nameSimilarity('Anna-Maria Eriksson', 'ERIKSSON ANNA MARIA'), 1)
  assert.ok(nameSimilarity('John Smith', 'Chioma Okafor') < 0.5)
  assert.equal(ageOn('2000-06-15', new Date('2026-06-14T00:00:00Z')), 25)
})
