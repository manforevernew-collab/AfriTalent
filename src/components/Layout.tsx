import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';
import SEO from './SEO';

interface LayoutProps {
  seo?: {
    title?: string;
    description?: string;
    keywords?: string;
  };
}

export default function Layout({ seo = {} }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO {...seo} />
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
