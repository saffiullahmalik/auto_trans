import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveUnit, belongsToUnit, matchTeacher, looseKey } from '../../extension/lib/units.js';

// Unit names as the portal spells them (taken from its filter options).
const portalUnits = ['Fractions', 'Fractions +, _', 'Fractions ×  , ÷', 'Fractions and Sets', 'Shapes', 'Division'];

test('resolves sheet unit names to the portal spelling', () => {
  assert.equal(resolveUnit(portalUnits, 'Fractions ×, ÷'), 'Fractions ×  , ÷');
  assert.equal(resolveUnit(portalUnits, 'Fractions +, −'), 'Fractions +, _'); // minus sign vs underscore
  assert.equal(resolveUnit(portalUnits, 'Fractions'), 'Fractions');
  assert.equal(resolveUnit(portalUnits, ' shapes '), 'Shapes');
  assert.equal(resolveUnit(portalUnits, 'Geometry'), null);
  assert.notEqual(looseKey('Fractions +, −'), looseKey('Fractions ×, ÷'));
});

const q = (grade, subject, unit) => ({ topic: { unit: { unit_name: unit, subject: { subject, grade: { name: grade } } } } });

test('keeps only questions of the assigned class and subject', () => {
  const a = { grade: '4', subject: 'Basic Mathematics Practice 4', unit: 'Shapes' };
  assert.equal(belongsToUnit(q('4', 'Basic  Mathematics Practice 4', 'Shapes'), a), true); // portal double space
  assert.equal(belongsToUnit(q('3', 'Basic Mathematics Practice 3', 'Shapes'), a), false); // same unit name, other class
  assert.equal(belongsToUnit(q('4', 'Basic  Mathematics Practice 4', 'Division'), a), false);
  const f = { grade: '4', subject: 'Basic Mathematics Practice 4', unit: 'Fractions +, −' };
  assert.equal(belongsToUnit(q('4', 'Basic  Mathematics Practice 4', 'Fractions +, _'), f), true);
});

test('matches the logged-in account to a teacher in the sheet', () => {
  const teachers = [{ name: 'Abdul Rasheed' }, { name: 'Imdad Hussain' }];
  assert.equal(matchTeacher(teachers, '  imdad   hussain ')?.name, 'Imdad Hussain');
  assert.equal(matchTeacher(teachers, 'Someone Else'), null);
  assert.equal(matchTeacher(teachers, undefined), null);
});
