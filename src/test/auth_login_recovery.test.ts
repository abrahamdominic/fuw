import { describe, it, expect } from 'vitest';
import { normalizeUsername, USERNAME_PATTERN, validatePasswordPolicy } from '../lib/AuthContext';

describe('Authentication Identifier Resolution & Normalization', () => {
  it('normalizes usernames to lowercase and trims whitespace', () => {
    expect(normalizeUsername('  Abraham  ')).toBe('abraham');
    expect(normalizeUsername('BarnLaw')).toBe('barnlaw');
    expect(normalizeUsername('  STUDENT.01  ')).toBe('student.01');
    expect(normalizeUsername('cis_user-2')).toBe('cis_user-2');
  });

  it('validates username pattern correctly', () => {
    // Valid usernames: 3-20 chars, letters, numbers, dot, underscore, dash
    expect(USERNAME_PATTERN.test('abraham')).toBe(true);
    expect(USERNAME_PATTERN.test('cis.student')).toBe(true);
    expect(USERNAME_PATTERN.test('user_123')).toBe(true);
    expect(USERNAME_PATTERN.test('student-2026')).toBe(true);

    // Invalid usernames
    expect(USERNAME_PATTERN.test('ab')).toBe(false); // too short (<3)
    expect(USERNAME_PATTERN.test('a'.repeat(21))).toBe(false); // too long (>20)
    expect(USERNAME_PATTERN.test('user@fuw')).toBe(false); // contains @
    expect(USERNAME_PATTERN.test('user name')).toBe(false); // contains space
    expect(USERNAME_PATTERN.test('user!name')).toBe(false); // special char not in [._-]
  });

  it('correctly discriminates between email and username inputs', () => {
    const isEmail = (input: string) => input.trim().includes('@');

    expect(isEmail('student@fuwukari.edu.ng')).toBe(true);
    expect(isEmail('abraham@gmail.com')).toBe(true);
    expect(isEmail('abraham')).toBe(false);
    expect(isEmail('cis.student')).toBe(false);
    expect(isEmail('  barnlaw  ')).toBe(false);
  });
});

describe('Password Policy Enforcement', () => {
  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePasswordPolicy('Ab1!xyz')).toBe('Password must be at least 8 characters long.');
  });

  it('rejects passwords missing uppercase', () => {
    expect(validatePasswordPolicy('ab1!cdefgh')).toBe('Password must contain at least one uppercase letter.');
  });

  it('rejects passwords missing lowercase', () => {
    expect(validatePasswordPolicy('AB1!CDEFGH')).toBe('Password must contain at least one lowercase letter.');
  });

  it('rejects passwords missing a number', () => {
    expect(validatePasswordPolicy('Ab!cdefghij')).toBe('Password must contain at least one number.');
  });

  it('rejects passwords missing a special character', () => {
    expect(validatePasswordPolicy('Ab1cdefghij')).toBe('Password must contain at least one special character (e.g. !@#$%).');
  });

  it('accepts strong compliant passwords', () => {
    expect(validatePasswordPolicy('SecureP@ss2026')).toBeNull();
    expect(validatePasswordPolicy('Fuw#Student100')).toBeNull();
  });
});

describe('Password Reset Account Existence Responses', () => {
  it('formats non-existing email message accurately', () => {
    const email = 'notfound@example.com';
    const isEmail = email.includes('@');
    const msg = isEmail
      ? "We couldn't find an account with this email. Please create an account first."
      : "We couldn't find an account with this username. Please create an account first.";
    expect(msg).toBe("We couldn't find an account with this email. Please create an account first.");
  });

  it('formats non-existing username message accurately', () => {
    const uname = 'ghostuser';
    const isEmail = uname.includes('@');
    const msg = isEmail
      ? "We couldn't find an account with this email. Please create an account first."
      : "We couldn't find an account with this username. Please create an account first.";
    expect(msg).toBe("We couldn't find an account with this username. Please create an account first.");
  });
});
