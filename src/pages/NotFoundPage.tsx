import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Building2, GraduationCap, Landmark, Layers, Search } from 'lucide-react';
import { SEO } from '../components/SEO';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { NOINDEX_ROUTES } from '../lib/seo/routes';
import { DIRECTORY_TOTALS, facultySlug } from '../lib/seo/directory';
import { catalogue } from '../data/catalogue';

/**
 * Route-not-found page.
 *
 * It carries `noindex, follow` and is never listed in sitemap.xml, and the
 * Netlify configuration answers unknown paths with a real HTTP 404 status
 * while still serving the application shell (see netlify.toml). It links
 * to the whole public directory so a mistyped or retired URL never dead-ends.
 */
export function NotFoundPage() {
  const meta = NOINDEX_ROUTES['/404'];

  return (
    <main className="info public-container">
      <SEO meta={meta} />
      <Breadcrumbs trail={meta.breadcrumbs} />

      <p className="kicker">ERROR 404 · PAGE NOT FOUND</p>
      <h1>We could not find that page in the FUW E-Library.</h1>
      <p className="subtitle">
        The address may be mistyped, or the material, collection or course it pointed to may have been renamed or
        withdrawn. Nothing is wrong with your account. Use one of the directories below to get back to the library.
      </p>

      <div className="info-grid">
        <section>
          <BookOpen size={28} />
          <h2>Search the library</h2>
          <p>
            <Link to="/library">Browse the digital library</Link> for lecture notes, handouts, projects and test &amp;
            exam past questions across every faculty.
          </p>
        </section>
        <section>
          <Building2 size={28} />
          <h2>Faculties &amp; departments</h2>
          <p>
            <Link to="/faculties">
              Explore all {DIRECTORY_TOTALS.faculties} faculties and {DIRECTORY_TOTALS.departments} departments
            </Link>{' '}
            of Federal University Wukari.
          </p>
        </section>
        <section>
          <GraduationCap size={28} />
          <h2>Course directory</h2>
          <p>
            <Link to="/courses">Look up a course code</Link> to see its level, semester and departments, then open the
            materials published for it.
          </p>
        </section>
        <section>
          <Landmark size={28} />
          <h2>Institutional repository</h2>
          <p>
            <Link to="/repository">Search the repository</Link> for final-year projects, theses, dissertations and
            research papers.
          </p>
        </section>
        <section>
          <Layers size={28} />
          <h2>Curated collections</h2>
          <p>
            <Link to="/collections">Open a curated collection</Link> when a librarian has already grouped the right
            material for a course or an exam.
          </p>
        </section>
        <section>
          <Search size={28} />
          <h2>Still stuck?</h2>
          <p>
            <Link to="/contact">Contact the library helpdesk</Link> and we will point you to the resource you were
            looking for.
          </p>
        </section>
      </div>

      <div className="section-head" style={{ padding: '0 1rem', marginTop: '2rem' }}>
        <div>
          <p className="kicker">JUMP BACK IN</p>
          <h2>Popular destinations</h2>
        </div>
      </div>
      <div className="dept-links-grid">
        <Link to="/" className="dept-link-item">
          <span>FUW E-Library home</span>
        </Link>
        <Link to="/help" className="dept-link-item">
          <span>Help &amp; library services</span>
        </Link>
        <Link to="/about" className="dept-link-item">
          <span>About the FUW E-Library</span>
        </Link>
        {catalogue.slice(0, 6).map((f) => (
          <Link key={f.name} to={`/faculties/${facultySlug(f)}`} className="dept-link-item">
            <span>{f.name}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}