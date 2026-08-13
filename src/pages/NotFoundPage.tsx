import React from 'react';
import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';
import SEO from '../components/SEO';

export default function NotFoundPage() {
  return (
    <>
      <SEO title="Page Not Found" description="The page you're looking for doesn't exist." />
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-slate-50 py-12 px-4">
        <div className="text-center max-w-md">
          <div className="w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl font-bold text-amber-600">404</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Page Not Found</h1>
          <p className="text-slate-600 mb-8">Sorry, we couldn't find the page you're looking for.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/" className="flex items-center justify-center gap-2 px-6 py-3 bg-amber-500 text-white font-medium rounded-xl hover:bg-amber-600 transition-colors">
              <Home className="h-4 w-4" /> Back to Home
            </Link>
            <button onClick={() => window.history.back()} className="flex items-center justify-center gap-2 px-6 py-3 bg-white text-slate-700 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
              <ArrowLeft className="h-4 w-4" /> Go Back
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
