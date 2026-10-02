import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './Logo';
import { GraduationCap, BookOpen, ShieldCheck, Mail, MapPin } from 'lucide-react';
import { facultySlug, shortFacultyName, DIRECTORY_TOTALS } from '../lib/seo/directory';
import { catalogue } from '../data/catalogue';

/**
 * Site footer.
 *
 * Two deliberate SEO choices here:
 *
 *  * Faculty links point at the permanent, indexable `/faculties/:slug` pages
 *    rather than at filtered `/library?faculty=…` views. Filtered views are
 *    `noindex`, so linking only to them would waste the crawl budget the
 *    directory pages exist to earn.
 *  * Every destination is a real route. A footer link to a retired route is an
 *    internal 404, and internal 404s are exactly what the 404 report in Search
 *    Console is for.
 */
const FOOTER_FACULTIES = [
  'Faculty of Agriculture & Life Sciences',
  'Faculty of Bio-Sciences',
  'Faculty of Computing & Information System',
  'Faculty of Physical Sciences',
  'Faculty of Law'
];

export function Footer() {
  const featured = FOOTER_FACULTIES.map((name) => catalogue.find((f) => f.name === name)).filter(Boolean);

  return (
    <footer className="main-footer">
      <div className="footer-content">
        <div className="footer-col brand-col">
          <div className="footer-brand">
            <Logo size={42} />
            <div>
              <h3>Federal University Wukari</h3>
              <p>E-Library &amp; Digital Repository</p>
            </div>
          </div>
          <p className="footer-desc">
            Empowering students, researchers, and faculty with 24/7 access to curated academic materials, past examination
            questions, research archives, and textbooks.
          </p>
          <div className="footer-contact-info">
            <span><MapPin size={14} /> PMB 1020, Kastina-Ala Road, Wukari, Taraba State, Nigeria</span>
            <span><Mail size={14} /> library@fuw.edu.ng</span>
          </div>
        </div>

        <div className="footer-col">
          <h4>Academic Faculties</h4>
          <ul className="footer-links">
            {featured.map((faculty) => (
              <li key={faculty!.name}>
                <Link to={`/faculties/${facultySlug(faculty!)}`}>{shortFacultyName(faculty!.name)}</Link>
              </li>
            ))}
            <li>
              <Link to="/faculties#college-of-health-sciences">College of Health Sciences</Link>
            </li>
            <li>
              <Link to="/faculties">
                View all {DIRECTORY_TOTALS.faculties} faculties &rarr;
              </Link>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>Quick Navigation</h4>
          <ul className="footer-links">
            <li><Link to="/library">Library Collection</Link></li>
            <li><Link to="/faculties">Faculties &amp; Departments</Link></li>
            <li><Link to="/courses">Course Directory</Link></li>
            <li><Link to="/repository">Institutional Repository</Link></li>
            <li><Link to="/collections">Curated Collections</Link></li>
            <li><Link to="/help">Help &amp; Library Services</Link></li>
            <li><Link to="/about">About the E-Library</Link></li>
            <li><Link to="/contact">Library Helpdesk</Link></li>
            <li><Link to="/student">Student Portal</Link></li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>Repository Policies</h4>
          <div className="footer-badges">
            <div className="badge-item">
              <ShieldCheck size={16} />
              <div>
                <b>Faculty Verified</b>
                <span>Peer-reviewed curriculum resources</span>
              </div>
            </div>
            <div className="badge-item">
              <BookOpen size={16} />
              <div>
                <b>Open Educational Access</b>
                <span>Free for all enrolled FUW candidates</span>
              </div>
            </div>
            <div className="badge-item">
              <GraduationCap size={16} />
              <div>
                <b>Structured Directory</b>
                <span>
                  {DIRECTORY_TOTALS.faculties} faculties, {DIRECTORY_TOTALS.departments} departments,{' '}
                  {DIRECTORY_TOTALS.courses} courses
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>© {new Date().getFullYear()} Federal University Wukari Digital Library. All rights reserved.</p>
        <div className="footer-bottom-links">
          <Link to="/about">Terms of Use</Link>
          <span>·</span>
          <Link to="/about">Privacy Policy</Link>
          <span>·</span>
          <Link to="/contact">Helpdesk</Link>
        </div>
      </div>
    </footer>
  );
}