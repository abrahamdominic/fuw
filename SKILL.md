## Additional FUW E-Library Requirements

Please also implement the following features in the existing FUW E-Library codebase.

### 1. Student Material Upload

Students should be able to upload academic materials directly from their dashboard.

Create a **"Upload Material"** section/page in the student dashboard using the same upload functionality and interface currently available in the Admin dashboard.

The student upload form should include:

* Material title
* Description
* Faculty
* Department
* Course
* Level
* Semester
* Material type
* File upload
* File format validation
* Maximum file size validation
* Upload progress/status
* Submit material button

Use the same supported file formats as the Admin upload system:

* PDF
* DOC/DOCX
* PPT/PPTX
* XLS/XLSX

Maximum file size should remain **25 MB**.

After a student submits a material:

* The material should **not be published immediately**.
* It should be saved with a **Pending Approval** status.
* The student should be able to see the material in a **My Uploads** section.
* Display the current status of each submission:

  * Pending
  * Approved
  * Rejected
* If rejected, display the rejection reason provided by the administrator.
* Students should be able to view their submitted materials and their approval status.

### 2. Admin Approval System

Every material uploaded by a student must require administrator approval before it becomes publicly available in the library.

Add a **Pending Student Uploads** section to the Admin Dashboard.

Administrators should be able to:

* View submitted materials.
* Preview/download the uploaded file.
* View the student's information.
* View faculty, department, course, level, semester, and material type.
* Approve a material.
* Reject a material.
* Enter a rejection reason.
* Delete inappropriate submissions.

When an administrator approves a material:

* Change its status to **Approved**.
* Make it available in the public library.
* Associate the material with the correct faculty, department, course, and level.

When an administrator rejects a material:

* Change its status to **Rejected**.
* Keep the material visible to the student under My Uploads.
* Display the administrator's rejection reason.

### 3. Student Dashboard Navigation

Update the student dashboard sidebar to include:

* Dashboard
* Upload Material
* My Uploads
* Saved Materials
* Recently Viewed
* Downloads
* Reading History
* My Profile
* Settings
* Log Out

Make sure every navigation item actually works and routes to the correct page.

### 4. Build the Student Settings Page

Create a complete **Settings** page for students.

The settings page should contain appropriate sections such as:

#### Account Settings

* Full name
* Display name
* Email address
* Matric number
* Faculty
* Department
* Level

Allow students to update editable profile information while protecting fields that should not be changed directly.

#### Security

Include:

* Change password
* Password confirmation
* Secure account/session management
* Sign out of the current session

#### Notification Preferences

Allow students to control notifications such as:

* Material approval notifications
* Material rejection notifications
* New library material notifications
* Account/security notifications

#### Reading Preferences

Include useful preferences such as:

* Default library view
* Preferred material sorting
* Remember last search/filter preferences

#### Account Actions

Include:

* Sign out
* Account deletion/deactivation option where appropriate

Use clear confirmation dialogs for destructive actions.

### 5. Build the Admin Settings Page

The Admin Dashboard currently has a **Settings** navigation item, but the Settings page needs to be fully implemented.

Create a complete Admin Settings interface containing appropriate sections.

#### General Settings

Allow administrators to manage:

* Library name
* Library description
* Contact email
* Support information
* Academic session
* Default settings for the library

#### Material Settings

Allow administrators to configure:

* Maximum upload file size
* Allowed file types
* Whether student uploads require approval
* Whether rejected materials remain visible to students
* Default material status

Student uploads should require administrator approval by default.

#### User & Student Settings

Include controls for:

* Student registration
* Account verification
* User access
* Student upload permissions
* Account activation/deactivation

#### Notification Settings

Allow administrators to configure notifications for:

* New student material submissions
* Material approval
* Material rejection
* New student registrations
* Security/account events

#### Security Settings

Include:

* Admin account information
* Change password
* Session management
* Sign out
* Security-related configuration

#### Library Management

Provide useful administrative controls for:

* Faculties
* Departments
* Courses
* Levels
* Material categories
* Academic sessions

### 6. Admin Settings UI

The Admin Settings page should use a clean settings layout with:

* Section navigation/sidebar
* Forms grouped by category
* Save Changes buttons
* Cancel/Reset functionality where appropriate
* Success notifications after saving
* Validation and error messages
* Confirmation dialogs for destructive actions

Settings should be persisted in the backend/database rather than only being stored in React state.

### 7. Backend & Database Integration

Do not build these features as frontend-only mock functionality.

Connect the new features to the existing backend/Supabase setup.

Create/use the necessary database structures for:

* Student material submissions
* Material approval status
* Rejection reasons
* Student upload history
* Admin settings
* Student settings/preferences
* Notification preferences

Make sure permissions are enforced so that:

* Students can only manage their own uploads and settings.
* Students cannot approve their own materials.
* Students cannot bypass the approval process.
* Only authorized administrators can approve/reject materials.
* Approved student materials become visible in the public library.
* Pending/rejected materials are not publicly available.

### 8. Keep Existing Features Working

Do not remove or break the existing:

* Homepage animation
* Library
* Search
* Faculties
* Departments
* Courses
* Authentication
* Supabase integration
* Admin dashboard
* Student dashboard
* Material browsing
* Downloads
* Saved materials
* Reading history

All new functionality should integrate naturally into the existing React/Vite architecture.

### 9. Mobile Responsiveness

All new Student Upload, My Uploads, Student Settings, Admin Settings, and Approval pages must be fully responsive on:

* Android
* iPhone/iOS
* Tablets
* Laptops
* Desktop

Ensure forms, settings panels, upload controls, tables, buttons, navigation, and approval actions remain easy to use on touchscreens and smaller displays.

