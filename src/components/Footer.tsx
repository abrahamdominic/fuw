import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './Logo';
import { GraduationCap, BookOpen, ShieldCheck, Mail, MapPin, Phone } from 'lucide-react';

export function Footer() {
  return (
    <footer className="main-footer">
      <div className="footer-content">
        <div className="footer-col brand-col">
          <div className="footer-brand">
            <Logo size={42} />
            <div>
              <h3>Federal University Wukari</h3>
              <p>E-Library & Digital Repository</p>
            </div>
          </div>
          <p className="footer-desc">
            Empowering students, researchers, and faculty with 24/7 access to curated academic materials, past examination questions, research archives, and textbooks.
          </p>
          <div className="footer-contact-info">
            <span><MapPin size={14} /> PMB 1020, Kastina-Ala Road, Wukari, Taraba State, Nigeria</span>
            <span><Mail size={14} /> library@fuw.edu.ng</span>
          </div>
        </div>

        <div className="footer-col">
          <h4>Academic Faculties</h4>
          <ul className="footer-links">
            <li><Link to="/library?faculty=Faculty+of+Agriculture+%26+Life+Sciences">Agriculture & Life Sciences</Link></li>
            <li><Link to="/library?faculty=Faculty+of+Bio-Sciences">Bio-Sciences</Link></li>
            <li><Link to="/library?faculty=Faculty+of+Computing+%26+Information+System">Computing & Information System</Link></li>
            <li><Link to="/library?faculty=Faculty+of+Engineering">Faculty of Engineering</Link></li>
            <li><Link to="/library?faculty=Faculty+of+Law">Faculty of Law</Link></li>
            <li><Link to="/library?faculty=College+of+Health+Sciences">College of Health Sciences</Link></li>
            <li><Link to="/faculties">View All 11 Faculties →</Link></li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>Quick Navigation</h4>
          <ul className="footer-links">
            <li><Link to="/library">Library Collection</Link></li>
            <li><Link to="/courses">Course Directory</Link></li>
            <li><Link to="/student">Student Portal</Link></li>
            <li><Link to="/student/upload">Submit Learning Material</Link></li>
            <li><Link to="/about">About FUW Digital Repository</Link></li>
            <li><Link to="/contact">Library Helpdesk</Link></li>
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
