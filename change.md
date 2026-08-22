Update the course/material navigation and filtering system so the hierarchy and user experience work exactly as follows:

### 1. Faculty → Department Dropdown

* When a user clicks or selects a **Faculty**, display all departments under that faculty in a **dropdown/expandable manner**.
* Only display departments that belong to the selected faculty.
* When the faculty changes, automatically update the department options.
* Keep the dropdown clean, responsive, and mobile-friendly.

### 2. Correct Selection Hierarchy

The complete selection structure must be:

**Faculty → Department → Level → Semester → Material Type → Course**

The **Course must always be the final/last selection**.

### 3. Cascading Filtering

Each selection must depend on the previous selection:

* **Faculty:** Show only departments under the selected faculty.
* **Department:** Show only levels and content available for that department.
* **Level:** Show only content belonging to the selected level.
* **Semester:** Show only content belonging to the selected semester within that level.
* **Material Type:** Show only materials belonging to the selected material type.
* **Course:** Finally, show only courses that match **all previous selections**.

### 4. Example

If a user selects:

**Faculty:** Science
→ **Department:** Microbiology
→ **Level:** 100 Level
→ **Semester:** First Semester
→ **Material Type:** Past Questions
→ **Course:** BIO101C General Biology I

The system should display **only BIO101C General Biology I Past Questions for 100 Level Microbiology, First Semester**.

Do not display:

* Courses from other levels
* Courses from other semesters
* Courses from other departments
* Other material types
* Materials belonging to other courses

### 5. Dynamic Filtering

The filtering must be completely dynamic and cascading.

For example:

If the user selects **100 Level**, hide all 200, 300, 400, and 500 Level content.

If the user then selects **First Semester**, hide all Second Semester content.

If the user selects **Past Questions**, hide Handouts, Projects, Test Questions, and other material types.

Finally, when the user selects a **Course**, display only materials belonging to that exact course and all previously selected filters.

### 6. Reset Dependent Selections

When a parent selection changes, automatically reset all selections that depend on it.

For example:

**Faculty changes**
→ Reset Department, Level, Semester, Material Type, and Course.

**Department changes**
→ Reset Level, Semester, Material Type, and Course.

**Level changes**
→ Reset Semester, Material Type, and Course.

**Semester changes**
→ Reset Material Type and Course.

**Material Type changes**
→ Reset Course.

This prevents invalid combinations and prevents irrelevant content from being displayed.

### 7. Data Integrity

* Use the existing faculty, department, level, semester, material type, and course data.
* Do not hardcode duplicate course lists unnecessarily.
* Ensure every course is correctly associated with its department, level, semester, and applicable material types.
* Only display options that actually have matching content.
* Do not show empty or irrelevant dropdown options.

### 8. UI/UX

Make the interface intuitive and easy to understand:

**Faculty**
↓
**Department**
↓
**Level**
↓
**Semester**
↓
**Material Type**
↓
**Course**

* Use dropdowns/select components where appropriate.
* Disable dependent dropdowns until the required previous selection has been made.
* Show a clear placeholder such as **"Select Level"**, **"Select Semester"**, **"Select Material Type"**, and **"Select Course"**.
* Keep the existing FUW E-Library design and branding.
* Make everything fully responsive on desktop, tablet, and mobile.

### 9. Final Requirement

Implement and test the complete cascading flow:

**Faculty → Department → Level → Semester → Material Type → Course → Materials**

At every stage, the user should see **only data relevant to their previous selections**. The Course must be the **last filter**, and the final results should contain only materials matching the complete selection.


-------------------------

Update the FUW E-Library faculty and department structure using the **exact faculty and department list provided below**.

Some of the existing faculties and departments in the application are incorrect. Replace the incorrect data with the structure below.

### Important Instructions

* **Do not change the existing course durations.** The current course/faculty durations are already correct and should remain exactly as they are.
* Update only the **faculty and department names/structure**.
* Each department must belong to the correct faculty shown below.
* When a user selects/clicks a faculty, display its departments in a **dropdown/expandable dropdown**.
* Do not mix departments between faculties.
* Remove outdated or incorrect departments that are currently in the system.
* Ensure the updated faculty/department structure is used consistently throughout the application, including:

  * Student dashboard
  * Admin dashboard
  * Material upload forms
  * Course/material search and filtering
  * Registration/profile forms
  * Faculty pages
  * Department dropdowns
  * Any other place where faculty or department data is displayed.
* Keep the existing UI/design, functionality, and responsiveness unless changes are required to support the new structure.

### Correct Faculty → Department Structure

#### 1. Faculty of Agriculture & Life Sciences

* Agricultural Economics & Extension
* Animal Production & Health
* Crop Production & Protection
* Fisheries & Aquaculture
* Food Science & Technology
* Forestry & Wildlife Management
* Soil Science & Land Resources Management

#### 2. Faculty of Bio-Sciences

* Biochemistry
* Biology/Biological Sciences
* Biotechnology
* Botany
* Microbiology
* Zoology

#### 3. Faculty of Computing & Information System

* Computer Science
* Information Technology
* Information Systems
* Cyber Security
* Software Engineering

#### 4. Faculty of Education

* Educational Foundations
* Curriculum Studies
* Educational Psychology
* Guidance & Counselling
* Science & Technical Education
* Chemistry Education
* Mathematics Education
* Physics Education

#### 5. Faculty of Engineering

* Agricultural Engineering
* Chemical Engineering
* Civil Engineering
* Computer Engineering
* Mechanical Engineering

#### 6. Faculty of Humanities

* African Traditional Religion
* Christian Religious Studies
* English & Literary Studies
* History & Diplomatic Studies
* Islamic Religious Studies
* Philosophy

#### 7. Faculty of Law

* Public & International Law
* Private & Commercial Law

#### 8. Faculty of Management Sciences

* Accounting
* Banking & Finance
* Business Administration
* Hospitality & Tourism Management
* Public Administration

#### 9. Faculty of Physical Sciences

* Chemistry
* Industrial Chemistry
* Mathematics
* Pure & Applied Physics
* Statistics

#### 10. Faculty of Social Sciences

* Economics
* Library & Information Science
* Political Science
* Sociology

### College of Health Sciences

The **College of Health Sciences** should be represented as the parent college/category containing the following four faculties:

#### 11. Faculty of Basic Medical Sciences

* Human Anatomy
* Human Physiology

#### 12. Faculty of Allied Health Sciences

* Medical Laboratory Science
* Physiotherapy

#### 13. Faculty of Clinical Sciences

* Medicine
* Surgery
* Community Medicine
* Family Medicine
* Paediatrics

#### 14. Faculty of Basic Clinical Sciences

* Medical Biochemistry
* Chemical Pathology
* Histopathology
* Haematology
* Pharmacology/Therapeutics

### Dropdown Behavior

Implement the structure so that the UI works like this:

**Faculty of Engineering ▼**

* Agricultural Engineering
* Chemical Engineering
* Civil Engineering
* Computer Engineering
* Mechanical Engineering

**Faculty of Bio-Sciences ▼**

* Biochemistry
* Biology/Biological Sciences
* Biotechnology
* Botany
* Microbiology
* Zoology

For the College of Health Sciences:

**College of Health Sciences ▼**

* **Faculty of Basic Medical Sciences ▼**

  * Human Anatomy
  * Human Physiology
* **Faculty of Allied Health Sciences ▼**

  * Medical Laboratory Science
  * Physiotherapy
* **Faculty of Clinical Sciences ▼**

  * Medicine
  * Surgery
  * Community Medicine
  * Family Medicine
  * Paediatrics
* **Faculty of Basic Clinical Sciences ▼**

  * Medical Biochemistry
  * Chemical Pathology
  * Histopathology
  * Haematology
  * Pharmacology/Therapeutics

### Data Consistency

Create/use a **single centralized faculty and department data structure** so the same correct data is used throughout the application. Avoid having separate hardcoded faculty/department lists in different components.

After updating the data:

1. Check every page that displays faculties.
2. Check every page that displays departments.
3. Check all faculty dropdowns.
4. Check all department dropdowns.
5. Check admin material upload.
6. Check student material upload.
7. Check course/material filtering.
8. Check search functionality.
9. Make sure existing course durations remain unchanged.
10. Make sure there are no references to the old/incorrect faculty or department names.

Do not modify unrelated features. Only update the faculty/department structure and make sure the new hierarchy works correctly everywhere in the application.

------------------------

Update the FUW E-Library level system and improve the course-page search bar.

### 1. Change Level Format

The current level format is incorrect because it uses thousands.

Replace:

* 1000 Level
* 2000 Level
* 3000 Level
* 4000 Level
* 5000 Level
* 6000 Level

With the correct university level format:

* **100 Level**
* **200 Level**
* **300 Level**
* **400 Level**
* **500 Level**
* **600 Level**

### 2. Update This Everywhere

Make sure the new level format is applied consistently throughout the entire application, including:

* Student dashboard
* Admin dashboard
* Course page
* Faculty page
* Department page
* Course/material filters
* Material upload forms
* Student material upload
* Admin material approval
* Search/filter functionality
* Database queries and stored level values
* Any dropdowns or selectors containing levels

Do not leave any references to `1000`, `2000`, `3000`, etc.

### 3. Respect Faculty/Programme Duration

Keep the existing programme/faculty duration rules that are already configured correctly.

For example:

* 4-year programmes → 100, 200, 300, 400
* 5-year programmes → 100, 200, 300, 400, 500
* 6-year programmes → 100, 200, 300, 400, 500, 600

Only display the levels applicable to the selected programme/department.

### 4. Design the Course Page Search Bar

The search bar on the **Course Page** should be properly designed and fully functional.

Create a modern, clean search bar that matches the existing FUW E-Library design and branding.

It should include:

* A clearly visible **search icon**
* A text input with a clear placeholder such as **"Search courses..."**
* Rounded/modern styling that matches the existing UI
* Proper spacing and alignment
* Responsive design for desktop, tablet, and mobile
* A clear focus/active state
* Smooth hover/focus interactions
* Search icon positioned neatly inside or beside the input

### 5. Search Functionality

The search bar should actually work.

When a user types:

`BIO101C`

show matching courses.

When a user types:

`General Biology`

show courses matching that name.

The search should be case-insensitive and update the results dynamically as the user types.

It should work together with the existing cascading filters:

**Faculty → Department → Level → Semester → Material Type → Course**

For example, if the user selects **100 Level + First Semester**, the search should only search courses within that filtered result set.

### 6. Final Testing

After making the changes:

* Verify all levels display as **100–600**, not 1000–6000.
* Verify level filtering works correctly.
* Verify the correct levels appear based on programme duration.
* Verify the course search icon/bar is properly designed.
* Verify the search actually filters courses.
* Verify the search works on mobile and desktop.
* Verify there are no broken references to the old level values.
* Do not change unrelated functionality or existing course durations.
