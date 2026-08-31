# Full Security Review & Penetration-Testing Assessment

I would like you to perform a **comprehensive security review of this entire project**.

Treat this as a professional security assessment conducted by an independent security researcher who has been hired to identify vulnerabilities before a malicious attacker does.

**Do not assume the application is secure. Do not give me a superficial review. Do not hold back from identifying serious issues.**

The objective is to determine whether the project can realistically withstand attacks from an unauthenticated external attacker, an authenticated low-privileged user, a malicious insider/user, and an attacker attempting to abuse application logic or infrastructure.

---

## 1. Use Multiple Security-Review Methodologies

Do not rely on only one security framework. Assess the project from several complementary angles.

### A. Adversarial / Attacker Perspective

Pretend you are a security researcher hired to attack this application.

Think like an attacker who has:

* No account
* A normal student/user account
* A low-privileged account
* An administrator account
* Knowledge of the application's public behavior
* Access to browser developer tools
* Access to publicly exposed API endpoints
* Access to publicly available project information
* Knowledge of the application's technology stack

Identify realistic attack paths such as:

* Authentication bypass
* Authorization bypass
* Privilege escalation
* IDOR/BOLA
* Account takeover
* Session/token abuse
* Password/OTP attacks
* Rate-limit bypass
* API abuse
* Input manipulation
* SQL injection
* XSS
* CSRF
* SSRF
* File upload vulnerabilities
* Path traversal
* Arbitrary file access
* Information disclosure
* Sensitive data exposure
* Business-logic abuse
* Race conditions
* Replay attacks
* Enumeration attacks
* Mass assignment
* Parameter pollution
* Insecure direct object references
* Admin-function abuse
* Database/RLS bypass
* Storage bucket abuse
* Misconfigured cloud services
* Exposed secrets
* Weak environment configuration
* Dependency vulnerabilities
* Supply-chain attacks
* Denial-of-service opportunities
* Security-header weaknesses
* CORS misconfiguration
* Webhook abuse
* API authentication weaknesses
* Client-side trust issues
* Server-side trust issues

For every potential attack, determine whether it is actually possible from the available code/configuration/evidence.

**Do not claim an exploit exists merely because it is theoretically possible.**

---

# 2. OWASP Top 10:2025 Assessment

Use the current **OWASP Top 10:2025** as one of the primary application-security frameworks.

OWASP identifies the 2025 edition as the current released version of the Top 10.

Assess the project against every applicable category, including:

1. Broken Access Control
2. Security Misconfiguration
3. Software Supply Chain Failures
4. Cryptographic Failures
5. Injection
6. Insecure Design
7. Authentication Failures
8. Software or Data Integrity Failures
9. Security Logging and Alerting Failures
10. Mishandling of Exceptional Conditions

Do not simply list the categories.

For each category:

* Inspect the actual implementation.
* Identify relevant attack surfaces.
* Determine whether a vulnerability exists.
* Explain exactly why.
* Identify the affected files/functions/endpoints/components.
* Provide evidence.
* Assign severity.
* Explain the realistic attack scenario.
* Explain the potential impact.
* Provide a remediation.
* Verify whether the remediation actually resolves the underlying issue.

The OWASP 2025 release should be treated as the baseline rather than relying on outdated OWASP Top 10:2021 guidance.

---

# 3. OWASP ASVS Assessment

Use the **OWASP Application Security Verification Standard (ASVS) 5.0.0** as a deeper verification framework.

OWASP currently identifies ASVS 5.0.0 as the latest stable version.

Use ASVS to go deeper than the Top 10.

Where applicable, assess areas such as:

* Architecture
* Authentication
* Session management
* Access control
* Input validation
* Output encoding
* Injection prevention
* Cryptography
* Error handling
* Logging
* Data protection
* API security
* File handling
* Business logic
* Configuration
* Communication security
* Secure development practices

Reference specific ASVS requirements whenever they are relevant.

When citing an ASVS requirement, identify the exact version and requirement ID so that the finding can be independently verified.

Do not invent ASVS requirements.

If a requirement is not applicable, explicitly state why.

---

# 4. STRIDE Threat Modeling

Perform a STRIDE-based threat model of the application.

Microsoft describes STRIDE as a framework for categorizing threats and recommends using threat modeling to identify threats and corresponding mitigations.

Analyze the system for:

### S — Spoofing

Can an attacker impersonate:

* Users
* Administrators
* Services
* API clients
* Other trusted entities?

### T — Tampering

Can an attacker modify:

* User data
* Courses
* Materials
* Requests
* Roles
* Permissions
* Database records
* API parameters
* Uploaded files
* Application state?

### R — Repudiation

Can users perform sensitive actions without adequate auditability?

Investigate:

* Audit logs
* Admin actions
* Authentication events
* Material changes
* Account changes
* Deletion requests
* Permission changes

### I — Information Disclosure

Can unauthorized users obtain:

* Personal information
* Emails
* Matric numbers
* Internal IDs
* Database information
* API responses
* Storage URLs
* Environment variables
* Secrets
* Administrative information?

### D — Denial of Service

Can attackers consume excessive:

* CPU
* Memory
* Database resources
* Storage
* API requests
* Authentication attempts
* File-processing resources?

### E — Elevation of Privilege

Can:

* Students become administrators?
* Normal users access admin functionality?
* Users modify permissions?
* Users bypass RLS?
* Users invoke privileged RPCs?
* Users access another user's resources?

Map the threats to the actual architecture rather than providing generic STRIDE examples.

---

# 5. Review the Entire Technology Stack

Identify the technologies actually used by the project.

Do not assume versions.

Inspect:

* package.json
* package-lock.json / yarn.lock / pnpm-lock.yaml
* framework versions
* authentication libraries
* database libraries
* Supabase configuration
* API libraries
* UI libraries
* build tools
* deployment configuration
* server configuration
* middleware
* edge functions
* serverless functions
* third-party integrations
* storage configuration
* CI/CD configuration
* environment configuration

For every security-relevant dependency:

1. Determine the installed version.
2. Search the web for the latest stable version.
3. Search for known CVEs/security advisories.
4. Check whether the installed version is affected.
5. Identify the severity of relevant vulnerabilities.
6. Determine whether the vulnerable component is actually reachable/exploitable in this application.
7. Recommend an upgrade where appropriate.

**Do not report a dependency as vulnerable merely because an old version exists. Verify the exact installed version and relevant advisory.**

Use authoritative sources wherever possible, including:

* Official project documentation
* GitHub security advisories
* NVD
* CISA
* Official package repositories
* Vendor security advisories
* OWASP
* Microsoft
* Other authoritative security sources

---

# 6. Authentication Security Review

Perform a complete authentication review.

Inspect:

* Registration
* Login
* Logout
* Password handling
* OTP authentication
* Email verification
* Password reset
* Session handling
* Refresh tokens
* Access tokens
* JWT handling
* Cookie configuration
* Session expiration
* Account activation/deactivation
* Admin authentication
* Admin invitations
* Authentication redirects
* Authentication middleware
* Rate limiting
* Brute-force protection
* Account enumeration
* Recovery mechanisms

Determine whether an attacker can:

* Bypass authentication
* Take over an account
* Reuse expired credentials
* Abuse OTPs
* Guess or replay OTPs
* Enumerate accounts
* Abuse password-reset flows
* Obtain another user's session
* Escalate from user → admin

---

# 7. Authorization & Access-Control Review

Treat authorization as one of the highest-priority areas.

For every protected resource and privileged operation, determine:

> "What exactly prevents an unauthorized user from performing this action?"

Inspect:

* Frontend route protection
* Backend authorization
* API authorization
* Database permissions
* Supabase RLS
* RPC functions
* Storage policies
* Admin permissions
* Role checks
* Ownership checks
* Faculty/department restrictions
* User-specific resources

Attempt to identify:

* Horizontal privilege escalation
* Vertical privilege escalation
* IDOR/BOLA
* Broken role checks
* Client-side-only authorization
* RLS bypass
* RPC privilege escalation
* Direct database access
* Parameter manipulation

Never consider a frontend `if (user.role === "admin")` check sufficient unless the server/database independently enforces the same authorization boundary.

---

# 8. Supabase & Database Security Review

If Supabase is used, perform a dedicated Supabase security audit.

Inspect:

* Authentication configuration
* PostgreSQL roles
* RLS
* Policies
* Functions
* RPCs
* SECURITY DEFINER functions
* SECURITY INVOKER functions
* Grants
* Storage buckets
* Storage policies
* Database triggers
* Foreign keys
* Constraints
* Views
* Exposed schemas
* API exposure
* Anonymous access
* Service-role usage
* JWT claims
* Database functions
* Search paths
* Privilege boundaries

Pay particular attention to:

* Policies that accidentally allow unrestricted access
* Policies that only protect reads but not writes
* Policies relying on client-supplied values
* SECURITY DEFINER functions with excessive privileges
* RPC functions callable by unauthorized roles
* Storage buckets that are unintentionally public
* Service-role keys exposed to the browser
* Sensitive data accessible through the REST API
* Cross-user data access
* Cross-role data access

Test the actual authorization model instead of assuming that because RLS is enabled, the database is secure.

---

# 9. API Security Review

For every API endpoint/function:

Determine:

* Is authentication required?
* Is authorization enforced?
* What inputs are accepted?
* Are inputs validated?
* Are types validated?
* Are IDs predictable?
* Can parameters be manipulated?
* Can another user's data be accessed?
* Are sensitive fields writable?
* Are responses leaking unnecessary information?
* Is rate limiting implemented?
* Are errors revealing internal information?
* Can requests be replayed?
* Are there race conditions?
* Are privileged operations protected?

Use the OWASP API Security guidance where applicable. OWASP maintains a dedicated API Security project for risks specific to APIs.

---

# 10. File Upload & Storage Security

If the application allows users to upload files, perform a dedicated file-security assessment.

Check:

* Allowed file types
* MIME validation
* File extension validation
* Magic-byte validation
* Maximum file size
* Filename sanitization
* Path traversal
* Malicious file uploads
* SVG security
* HTML uploads
* JavaScript uploads
* PDF handling
* Archive handling
* Storage permissions
* Public/private buckets
* Download authorization
* File replacement
* File deletion
* Storage enumeration
* Malware scanning
* Content-type handling

Determine whether a malicious user can upload content that could execute code, steal data, bypass access controls, or attack another user.

---

# 11. Business-Logic Security

Do not restrict the audit to traditional technical vulnerabilities.

Understand what the application is designed to do and attempt to abuse its intended functionality.

Examples:

* Can users bypass limits?
* Can users submit duplicate requests?
* Can users approve their own requests?
* Can users manipulate status fields?
* Can users bypass approval workflows?
* Can students modify protected profile information?
* Can users delete resources they do not own?
* Can users manipulate counters?
* Can users upload unauthorized materials?
* Can users bypass faculty/department restrictions?
* Can users abuse admin workflows?

Look for situations where every individual API call is technically valid but the overall sequence produces an unauthorized result.

---

# 12. Frontend Security

Inspect the frontend for:

* XSS
* DOM XSS
* Unsafe HTML rendering
* `dangerouslySetInnerHTML`
* Unsafe URL handling
* Token exposure
* Sensitive data stored in localStorage
* Sensitive data stored in sessionStorage
* Client-side authorization
* Exposed environment variables
* Debug information
* Source-map exposure
* API key exposure
* Insecure redirects
* Open redirects
* Third-party scripts
* CSP issues
* Dependency risks

Remember that frontend code is fully visible to an attacker.

Never treat a secret embedded in frontend JavaScript as secret.

---

# 13. Security Headers & Browser Security

Inspect the production deployment for:

* Content-Security-Policy
* Strict-Transport-Security
* X-Content-Type-Options
* Referrer-Policy
* Permissions-Policy
* Frame protection
* CORS
* Cookie attributes
* Secure
* HttpOnly
* SameSite
* Cache-Control where appropriate

Determine whether the configuration is appropriate for the application's architecture.

Do not recommend headers blindly. Explain what each header protects against and whether it is applicable.

---

# 14. Secrets & Configuration

Search the entire project for accidentally exposed secrets.

Check:

* API keys
* Supabase keys
* Service-role keys
* JWT secrets
* Database credentials
* OAuth secrets
* Private tokens
* Webhook secrets
* Deployment credentials
* `.env` files
* Git history
* Client-side bundles
* Configuration files
* CI/CD files

Differentiate between:

* Public identifiers intentionally safe for client-side use
* Credentials that must never be exposed

If a secret is discovered, clearly identify the severity and explain whether it should be rotated.

**Never reproduce live secrets in the report. Redact them.**

---

# 15. Dependency & Supply-Chain Security

Perform a dependency audit.

Check:

* Direct dependencies
* Transitive dependencies
* Outdated packages
* Known vulnerabilities
* Deprecated packages
* Unmaintained packages
* Suspicious packages
* Typosquatting risks
* Lockfile integrity
* Installation scripts
* Build scripts
* Dependency confusion risks

OWASP Top 10:2025 specifically elevates software supply-chain failures as a major application-security category.

Use current security advisories and package information rather than relying on memory.

---

# 16. Error Handling & Information Disclosure

Inspect all error paths.

Check whether errors reveal:

* Database structure
* SQL statements
* Internal paths
* Stack traces
* Framework versions
* User existence
* Authentication state
* Internal IDs
* Environment variables
* Infrastructure information

Also check for insecure failure behavior.

OWASP Top 10:2025 specifically includes **Mishandling of Exceptional Conditions**, covering issues such as improper error handling, logical errors, and failing-open behavior.

---

# 17. Logging, Monitoring & Detection

Determine whether security-sensitive events are logged appropriately.

Inspect:

* Login attempts
* Failed authentication
* Password changes
* Account changes
* Admin actions
* Role changes
* Permission changes
* Material deletion
* Profile changes
* Suspicious API activity
* Rate-limit violations

Determine whether the application could detect an ongoing attack.

Do not simply recommend "add logging."

Identify exactly:

* What should be logged
* Where
* With what metadata
* What should never be logged
* How alerts could be triggered

---

# 18. Attack-Path Analysis

After identifying individual weaknesses, chain them together.

For example:

> Low-privileged account → IDOR → sensitive information disclosure → privilege escalation → administrative functionality.

Look for combinations of vulnerabilities that individually appear low-risk but collectively create a critical attack path.

Prioritize realistic attack chains over isolated theoretical issues.

---

# 19. Evidence Requirements

This is extremely important:

**Do not make anything up.**

Every security claim must be backed by evidence.

For every finding, provide:

### Finding

Clear vulnerability title.

### Severity

* Critical
* High
* Medium
* Low
* Informational

### Confidence

* Confirmed
* Highly likely
* Potential
* Unable to verify

### Evidence

Identify the exact:

* File
* Function
* Component
* Endpoint
* Database policy
* SQL function
* Configuration
* Dependency
* Deployment setting

where possible.

### Attack Scenario

Explain how an attacker could realistically exploit it.

### Impact

Explain what the attacker could gain or modify.

### Source

Provide authoritative sources supporting the security principle, vulnerability classification, or recommendation.

### Remediation

Provide the concrete fix.

### Verification

Explain how to verify that the vulnerability has actually been fixed.

---

# 20. Source Requirements

Use web searches whenever current information is necessary.

Especially search for:

* Current package versions
* Current CVEs
* Current security advisories
* OWASP updates
* Supabase security documentation
* Framework security advisories
* Browser security standards
* Deployment-platform security documentation
* Authentication/security standards
* Relevant vendor advisories

Prefer primary/authoritative sources.

Every external security claim should have a source that I can independently verify.

Do not cite random blogs when an official source exists.

Do not fabricate sources.

Do not cite a source merely because its title sounds relevant. Verify that the source actually supports the claim being made.

---

# 21. Do Not Assume

This is a strict requirement.

If something cannot be verified from:

* The source code
* Configuration
* Project files
* Deployment information
* Official documentation
* Reliable security research
* Direct testing

then explicitly say:

> "Unable to verify."

Do not turn an assumption into a finding.

Distinguish clearly between:

**Confirmed vulnerability**

and

**Potential vulnerability requiring additional verification.**

---

# 22. Testing Philosophy

Be aggressive in your reasoning but responsible in execution.

You are authorized to assess this project as a security researcher.

You may inspect and analyze:

* Source code
* Configuration
* APIs
* Database policies
* Authentication flows
* Public application behavior
* Dependencies
* Deployment configuration

Where actual live testing is possible, prioritize **non-destructive security testing**.

Do not intentionally:

* Destroy production data
* Delete user accounts
* Exfiltrate real user data
* Disrupt availability
* Send destructive payloads
* Modify production records unnecessarily

Use safe proof-of-concept validation whenever possible.

---

# 23. Final Security Report

At the end, produce a professional security report containing:

## Executive Summary

Explain:

* Overall security posture
* Most important risks
* Whether the application appears production-ready from a security perspective
* Major areas requiring attention

## Risk Summary

Create a table:

| ID | Finding | Severity | Confidence | Affected Component | Status |
| -- | ------- | -------- | ---------- | ------------------ | ------ |

## Critical Findings

List all confirmed Critical issues.

## High-Severity Findings

List all confirmed High issues.

## Medium-Severity Findings

List all confirmed Medium issues.

## Low-Severity Findings

List all confirmed Low issues.

## Informational Findings

List hardening opportunities that are not necessarily vulnerabilities.

## OWASP Top 10:2025 Results

Show each category and its result.

## OWASP ASVS Results

Show relevant requirements and whether they pass, fail, or cannot be verified.

## STRIDE Results

Show the threats identified under:

* Spoofing
* Tampering
* Repudiation
* Information Disclosure
* Denial of Service
* Elevation of Privilege

## Attack Chains

Document realistic multi-step attack paths.

## Dependency Security

List vulnerable/outdated dependencies with evidence.

## Remediation Plan

Prioritize fixes in this order:

1. Critical
2. High
3. Medium
4. Low
5. Hardening

For every remediation, explain exactly what needs to change.

---

# 24. Final Verification

Do not stop after finding vulnerabilities.

After recommending fixes, explain how each fix should be tested.

Where the project is modified during the review, re-test the affected security boundary.

The goal is not merely to produce a list of vulnerabilities.

The goal is to determine:

> **"Can an attacker actually compromise this application, and if so, what is the complete path from initial access to impact?"**

Be skeptical.

Be evidence-driven.

Be technically rigorous.

Do not hide serious findings because they may be inconvenient.

Do not exaggerate theoretical risks.

Do not assume something is secure simply because a security feature exists.

And most importantly:

**If you cannot verify something, say that you cannot verify it rather than guessing.**

You are allowed to stop the assessment and ask me for additional information whenever something genuinely cannot be determined from the available project/code/configuration. Do not ask unnecessary questions or ask me to provide information that you can independently obtain by inspecting the project or using authoritative web sources.
