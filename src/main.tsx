import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import './styles.css';

import { MaterialItem } from './lib/store';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ToastProvider } from './components/Toast';
import { DocumentReaderModal } from './components/DocumentReaderModal';

import {
  HomePage,
  LibraryPage,
  FacultiesPage,
  CoursesPage,
  MaterialDetailPage,
  AboutPage,
  LoginPage,
  AdminLoginPage
} from './pages/PublicPages';

import { StudentPortal } from './pages/StudentPortal';
import { AdminPortal } from './pages/AdminPortal';

function PublicLayout({
  children,
  onReadOnline
}: {
  children: React.ReactNode;
  onReadOnline: (m: MaterialItem) => void;
}) {
  return (
    <div className="site-wrapper">
      <Header />
      <div className="content-grow">{children}</div>
      <Footer />
    </div>
  );
}

function App() {
  const [readingMaterial, setReadingMaterial] = useState<MaterialItem | null>(null);

  const handleReadOnline = (material: MaterialItem) => {
    setReadingMaterial(material);
  };

  return (
    <ToastProvider>
      <Routes>
        {/* Student Portal Routes */}
        <Route
          path="/student/*"
          element={<StudentPortal onReadOnline={handleReadOnline} />}
        />

        {/* Admin Portal Routes */}
        <Route
          path="/admin/login"
          element={<AdminLoginPage />}
        />
        <Route
          path="/admin/*"
          element={<AdminPortal onReadOnline={handleReadOnline} />}
        />

        {/* Public Pages Layout */}
        <Route
          path="/"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <HomePage onReadOnline={handleReadOnline} />
            </PublicLayout>
          }
        />
        <Route
          path="/library"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <LibraryPage onReadOnline={handleReadOnline} />
            </PublicLayout>
          }
        />
        <Route
          path="/faculties"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <FacultiesPage />
            </PublicLayout>
          }
        />
        <Route
          path="/departments"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <FacultiesPage />
            </PublicLayout>
          }
        />
        <Route
          path="/courses"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <CoursesPage />
            </PublicLayout>
          }
        />
        <Route
          path="/materials/:id"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <MaterialDetailPage onReadOnline={handleReadOnline} />
            </PublicLayout>
          }
        />
        <Route
          path="/about"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <AboutPage />
            </PublicLayout>
          }
        />
        <Route
          path="/contact"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <AboutPage contact />
            </PublicLayout>
          }
        />
        <Route
          path="/login"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <LoginPage />
            </PublicLayout>
          }
        />
        <Route
          path="/register"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <LoginPage register />
            </PublicLayout>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicLayout onReadOnline={handleReadOnline}>
              <LoginPage />
            </PublicLayout>
          }
        />
        <Route
          path="*"
          element={<Navigate to="/library" replace />}
        />
      </Routes>

      {/* Global Interactive Document Reader Modal */}
      {readingMaterial && (
        <DocumentReaderModal
          material={readingMaterial}
          onClose={() => setReadingMaterial(null)}
        />
      )}
    </ToastProvider>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
