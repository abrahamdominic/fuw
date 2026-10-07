import { describe, it, expect } from 'vitest';
import {
  formatPhoneNumberForCall,
  formatWhatsAppUrl,
  ROOMMATE_ACCOMMODATION_TYPES,
  ACCOMMODATION_LOCATIONS,
  type RoommateRequest,
  type PublishRoommateRequestInput
} from '../lib/accommodation';
import fs from 'node:fs';
import path from 'node:path';

describe('Roommate Finder Platform Unit & Security Tests', () => {
  describe('Contact Affordance Formatting', () => {
    it('formats local Nigerian phone numbers for international tel protocol', () => {
      expect(formatPhoneNumberForCall('08012345678')).toBe('+2348012345678');
      expect(formatPhoneNumberForCall('07098765432')).toBe('+2347098765432');
      expect(formatPhoneNumberForCall('+2348123456789')).toBe('+2348123456789');
      expect(formatPhoneNumberForCall('090-1234-5678')).toBe('+2349012345678');
    });

    it('formats WhatsApp click-to-chat links with international code and URI encoding', () => {
      const wa1 = formatWhatsAppUrl('08012345678', 'Hello! Looking for a roommate.');
      expect(wa1).toContain('https://wa.me/2348012345678');
      expect(wa1).toContain('text=Hello!%20Looking%20for%20a%20roommate.');

      const wa2 = formatWhatsAppUrl('+2348123456789');
      expect(wa2).toContain('https://wa.me/2348123456789');
      expect(wa2).toContain('text=');
    });
  });

  describe('Accommodation Preferences & Domain Types', () => {
    it('contains all required FUW accommodation types', () => {
      expect(ROOMMATE_ACCOMMODATION_TYPES).toContain('Shared Lodge');
      expect(ROOMMATE_ACCOMMODATION_TYPES).toContain('Self-Contain');
      expect(ROOMMATE_ACCOMMODATION_TYPES).toContain('Single Room');
      expect(ROOMMATE_ACCOMMODATION_TYPES).toContain('Flat / Apartment');
      expect(ROOMMATE_ACCOMMODATION_TYPES).toContain('Bedspace');
      expect(ROOMMATE_ACCOMMODATION_TYPES).toContain('Any / Flexible');
    });

    it('contains all standard Wukari campus environs locations', () => {
      expect(ACCOMMODATION_LOCATIONS).toContain('New Site');
      expect(ACCOMMODATION_LOCATIONS).toContain('Old Site');
      expect(ACCOMMODATION_LOCATIONS).toContain('Hospital Road');
      expect(ACCOMMODATION_LOCATIONS).toContain('Stadium Road');
      expect(ACCOMMODATION_LOCATIONS).toContain('Campus Environs');
    });
  });

  describe('Database Schema & Migration Security Invariants', () => {
    const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20261006200000_roommate_finder.sql');

    it('migration file exists and configures public.roommate_requests with strict RLS', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, 'utf8');

      // Check table creation
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.roommate_requests');
      expect(sql).toContain('target_gender TEXT NOT NULL CHECK (target_gender IN (\'Male\', \'Female\', \'Any\'))');
      expect(sql).toContain('budget_min NUMERIC(12, 2) NOT NULL CHECK (budget_min >= 0)');
      expect(sql).toContain('budget_max NUMERIC(12, 2) NOT NULL CHECK (budget_max >= budget_min)');

      // Check RLS
      expect(sql).toContain('ALTER TABLE public.roommate_requests ENABLE ROW LEVEL SECURITY;');
      expect(sql).toContain('CREATE POLICY "roommate_requests_select"');
      expect(sql).toContain('CREATE POLICY "roommate_requests_insert"');
      expect(sql).toContain('CREATE POLICY "roommate_requests_update"');
      expect(sql).toContain('CREATE POLICY "roommate_requests_delete"');

      // Check ownership enforcement
      expect(sql).toContain('student_id = auth.uid()');
    });

    it('implements gender-based notification routing inside publish_roommate_request', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');

      // Check SECURITY DEFINER function
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.publish_roommate_request');
      expect(sql).toContain('SECURITY DEFINER');

      // Check gender matching filter logic
      expect(sql).toContain('p_target_gender = \'Any\'');
      expect(sql).toContain('p.gender = p_target_gender');

      // Check notification insertion into existing notifications table
      expect(sql).toContain('INSERT INTO public.notifications');
      expect(sql).toContain('dedupe_key');
      expect(sql).toContain('category,');
      expect(sql).toContain('\'accommodation\'');
    });

    it('provides atomic view counting and status transition functions', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');

      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.increment_roommate_request_view');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.set_roommate_request_status');
      expect(sql).toContain('CHECK (status IN (\'active\', \'matched\', \'closed\'))');
    });
  });

  describe('Roommate Request Input Validation Contract', () => {
    it('validates budget limits and logic', () => {
      const validateInput = (input: PublishRoommateRequestInput) => {
        if (input.budget_min < 0) return 'Budget cannot be negative';
        if (input.budget_max < input.budget_min) return 'Max budget must be greater than or equal to min budget';
        if (input.description.trim().length < 15) return 'Description too short';
        if (!['Male', 'Female', 'Any'].includes(input.target_gender)) return 'Invalid gender';
        return null;
      };

      expect(validateInput({
        target_gender: 'Male',
        budget_min: -100,
        budget_max: 50000,
        accommodation_type: 'Shared Lodge',
        preferred_location: 'New Site',
        description: 'Need a quiet roommate for this semester.',
        phone_number: '08012345678',
        whatsapp_number: '08012345678'
      })).toBe('Budget cannot be negative');

      expect(validateInput({
        target_gender: 'Female',
        budget_min: 100000,
        budget_max: 50000,
        accommodation_type: 'Self-Contain',
        preferred_location: 'Hospital Road',
        description: 'Need a quiet roommate for this semester.',
        phone_number: '08012345678',
        whatsapp_number: '08012345678'
      })).toBe('Max budget must be greater than or equal to min budget');

      expect(validateInput({
        target_gender: 'Male',
        budget_min: 40000,
        budget_max: 80000,
        accommodation_type: 'Shared Lodge',
        preferred_location: 'New Site',
        description: 'Short',
        phone_number: '08012345678',
        whatsapp_number: '08012345678'
      })).toBe('Description too short');

      expect(validateInput({
        target_gender: 'Any',
        budget_min: 50000,
        budget_max: 100000,
        accommodation_type: 'Shared Lodge',
        preferred_location: 'Campus Environs',
        description: 'Looking for a clean, serious studying student to share a 2-room flat.',
        phone_number: '08012345678',
        whatsapp_number: '08012345678'
      })).toBeNull();
    });
  });
});
