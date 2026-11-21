// Matching assignment rows (Class + Subject + Unit name, as typed in the
// coordinator's sheet) to the portal's own spelling. The portal has quirks such
// as double spaces ("Basic  Mathematics Practice 4", "Fractions ×  , ÷") and an
// underscore where the sheet has a minus sign ("Fractions +, _").

/** Whitespace-insensitive, dash-insensitive comparison key for unit names. */
export function looseKey(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―−_-]/g, '-')
    .replace(/\s+/g, '');
}

/** Case- and space-insensitive key for subject names and class numbers. */
export function nameKey(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^(grade|class)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find the portal's spelling of a unit name among the filter options. */
export function resolveUnit(unitOptions, unitName) {
  const key = looseKey(unitName);
  return unitOptions.find((u) => looseKey(u) === key) ?? null;
}

/** Does a portal question belong to the assigned unit (same class, subject and unit)? */
export function belongsToUnit(question, assignment) {
  const unit = question?.topic?.unit;
  const subject = unit?.subject;
  return (
    looseKey(unit?.unit_name) === looseKey(assignment.unit) &&
    nameKey(subject?.grade?.name) === nameKey(assignment.grade) &&
    nameKey(subject?.subject) === nameKey(assignment.subject)
  );
}

export function unitLabel(a) {
  return `Class ${a.grade} · ${a.unit}`;
}

/** Pick the teacher whose name matches the logged-in account, if any. */
export function matchTeacher(teachers, accountName) {
  const key = nameKey(accountName);
  if (!key) return null;
  return teachers.find((t) => nameKey(t.name) === key) ?? null;
}
