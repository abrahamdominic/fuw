import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isSafeUrl, htmlToMarkdown, richPasteText } from '../lib/messageFormat';

describe('Security Hardening & Penetration Test Verification', () => {
  describe('Input Sanitization & Safe URL Protocol Whitelisting', () => {
    it('blocks dangerous URI schemes and script execution payloads', () => {
      const maliciousPayloads = [
        'javascript:alert(1)',
        'JAVASCRIPT:alert(document.cookie)',
        'javascript:void(0)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        'javascript:/*--></title></style></textarea></script><svg/onload=alert(1)>',
        '   javascript:alert(1)   ',
        'jav&#x09;ascript:alert(1)',
        'http://evil.com/ <script>',
        'https://example.com/test?param=<script>alert(1)</script>'
      ];

      for (const payload of maliciousPayloads) {
        expect(isSafeUrl(payload)).toBe(false);
      }
    });

    it('allows legitimate safe protocols: https, http, mailto, tel', () => {
      expect(isSafeUrl('https://fuw.edu.ng')).toBe(true);
      expect(isSafeUrl('http://fuw.edu.ng/library')).toBe(true);
      expect(isSafeUrl('mailto:support@fuw.edu.ng')).toBe(true);
      expect(isSafeUrl('tel:+2348039218841')).toBe(true);
      expect(isSafeUrl('fuw.edu.ng/portal')).toBe(true);
    });

    it('sanitizes untrusted HTML paste content without DOM innerHTML execution', () => {
      const dirtyHtml = '<p>Hello <b>World</b><script>alert("xss")</script><img src="x" onerror="alert(1)"></p>';
      const sanitized = htmlToMarkdown(dirtyHtml);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('onerror');
      expect(sanitized).toContain('**World**');
    });

    it('safely decodes HTML entities without invoking innerHTML or textarea creation', () => {
      const htmlWithEntities = '&lt;b&gt;FUW&lt;/b&gt; &amp; &quot;Campus&quot; &#39;Hub&#39;';
      const result = htmlToMarkdown(htmlWithEntities);
      expect(result).not.toContain('&lt;');
      expect(result).not.toContain('&gt;');
      expect(result).not.toContain('&amp;');
      expect(result).toContain('FUW');
      expect(result).toContain('"Campus"');
    });
  });

  describe('PostgreSQL RLS & Trigger Hardening Invariants', () => {
    const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20261006230000_accommodation_security_hardening.sql');

    it('verifies remediation migration file exists', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('verifies public.is_platform_admin() enforces active status and hardened search_path', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.is_platform_admin()');
      expect(sql).toContain("SET search_path = public, pg_temp");
      expect(sql).toContain("role::text IN ('admin', 'super_admin')");
      expect(sql).toContain("is_active = true");
      expect(sql).toContain("REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC");
    });

    it('verifies accommodation_providers guard prevents non-admin self-verification', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.accommodation_provider_guard()');
      expect(sql).toContain('NEW.is_verified := false;');
      expect(sql).toContain('NEW.verification_notes := NULL;');
      expect(sql).toContain('NEW.is_verified IS DISTINCT FROM OLD.is_verified');
      expect(sql).toContain('Only active platform administrators may alter provider verification status');
      expect(sql).toContain('CREATE TRIGGER trg_accommodation_provider_guard');
    });

    it('verifies accommodation_properties guard prevents self-featured listings and view tampering', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.accommodation_property_guard()');
      expect(sql).toContain('NEW.is_featured := false;');
      expect(sql).toContain('NEW.view_count := 0;');
      expect(sql).toContain('NEW.is_featured IS DISTINCT FROM OLD.is_featured');
      expect(sql).toContain('Only active platform administrators may feature accommodation properties');
      expect(sql).toContain('NEW.view_count := OLD.view_count');
      expect(sql).toContain('CREATE TRIGGER trg_accommodation_property_guard');
    });

    it('verifies atomic accommodation and roommate view increments with session flag protection', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      expect(sql).toContain("set_config('fuw.in_accommodation_view_increment', '1', true)");
      expect(sql).toContain("current_setting('fuw.in_accommodation_view_increment', true)");
      expect(sql).toContain("set_config('fuw.in_roommate_view_increment', '1', true)");
      expect(sql).toContain("current_setting('fuw.in_roommate_view_increment', true)");
    });

    it('verifies roommate request ownership immutability', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      expect(sql).toContain('NEW.student_id := OLD.student_id;');
      expect(sql).toContain('NEW.created_at := OLD.created_at;');
      expect(sql).toContain('CREATE TRIGGER trg_roommate_request_guard');
    });
  });

  describe('Payment Webhook and Escrow Defense Verification', () => {
    it('verifies Paystack webhook enforces HMAC-SHA512 verification on raw request body', () => {
      const webhookPath = path.resolve(__dirname, '../../supabase/functions/paystack-webhook/index.ts');
      const content = fs.readFileSync(webhookPath, 'utf8');
      expect(content).toContain('crypto.subtle.importKey');
      expect(content).toContain('crypto.subtle.verify');
      expect(content).toContain('x-paystack-signature');
      expect(content).toContain('PAYSTACK_SECRET_KEY');
    });

    it('verifies Marketplace webhook enforces HMAC-SHA512 verification on raw request body', () => {
      const mpWebhookPath = path.resolve(__dirname, '../../supabase/functions/marketplace-paystack-webhook/index.ts');
      const content = fs.readFileSync(mpWebhookPath, 'utf8');
      expect(content).toContain('crypto.subtle.importKey');
      expect(content).toContain('crypto.subtle.verify');
      expect(content).toContain('x-paystack-signature');
    });

    it('verifies Paystack webhook enforces 1MB body size cap to mitigate DOS', () => {
      const webhookPath = path.resolve(__dirname, '../../supabase/functions/paystack-webhook/index.ts');
      const content = fs.readFileSync(webhookPath, 'utf8');
      expect(content).toContain('1024 * 1024');
      expect(content).toContain('Webhook payload is too large');
    });
  });
});
