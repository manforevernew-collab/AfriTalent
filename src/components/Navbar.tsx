import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, Search, Bell, User, Briefcase, Building2, Star } from 'lucide-react';
import AfriTalentLogo from './AfriTalentLogo';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo - flex-shrink-0 prevents overlap */}
          <div className="flex-shrink-0" style={{ minWidth: '160px' }}>
            <Link to="/" className="block hover:opacity-90 transition-opacity">
              <AfriTalentLogo size="md" />
            </Link>
          </div>

          {/* Desktop Search */}
          <div className="hidden md:flex flex-1 max-w-lg mx-6 lg:mx-8">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search businesses, jobs, talent..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-1 flex-shrink-0">
            <Link to="/businesses" className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-amber-600 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap">
              <Building2 className="h-4 w-4" /> Businesses
            </Link>
            <Link to="/jobs" className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-amber-600 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap">
              <Briefcase className="h-4 w-4" /> Jobs
            </Link>
            <Link to="/reviews" className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-amber-600 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap">
              <Star className="h-4 w-4" /> Reviews
            </Link>
          </div>

          {/* Right side */}
          <div className="hidden md:flex items-center space-x-2 ml-4 flex-shrink-0">
            <button className="p-2 text-slate-500 hover:text-amber-600 hover:bg-slate-50 rounded-full transition-colors relative">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-red-500 rounded-full"></span>
            </button>
            <Link to="/login" className="flex items-center space-x-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-full hover:bg-amber-600 transition-colors whitespace-nowrap">
              <User className="h-4 w-4" /> <span>Sign In</span>
            </Link>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center flex-shrink-0 ml-2">
            <button onClick={() => setIsOpen(!isOpen)} className="p-2 text-slate-600 hover:text-amber-600 hover:bg-slate-50 rounded-md transition-colors">
              {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="md:hidden bg-white border-t border-slate-200">
          <div className="px-4 pt-4 pb-6 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input type="text" placeholder="Search..." className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <Link to="/businesses" className="flex items-center gap-2 px-3 py-2.5 text-base font-medium text-slate-700 hover:text-amber-600 hover:bg-slate-50 rounded-lg">
              <Building2 className="h-5 w-5" /> Businesses
            </Link>
            <Link to="/jobs" className="flex items-center gap-2 px-3 py-2.5 text-base font-medium text-slate-700 hover:text-amber-600 hover:bg-slate-50 rounded-lg">
              <Briefcase className="h-5 w-5" /> Jobs
            </Link>
            <Link to="/reviews" className="flex items-center gap-2 px-3 py-2.5 text-base font-medium text-slate-700 hover:text-amber-600 hover:bg-slate-50 rounded-lg">
              <Star className="h-5 w-5" /> Reviews
            </Link>
            <Link to="/login" className="block w-full text-center px-4 py-2.5 bg-amber-500 text-white font-medium rounded-lg hover:bg-amber-600 transition-colors">
              Sign In
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
