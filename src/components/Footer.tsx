import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, MapPin, Phone, Twitter, Linkedin, Instagram, Youtube } from 'lucide-react';
import AfriTalentLogo from './AfriTalentLogo';

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="space-y-4">
            <AfriTalentLogo size="md" variant="light" />
            <p className="text-sm text-slate-400 leading-relaxed">
              Africa's premier platform connecting top talent with leading businesses. 
              Discover, review, and grow with AfriTalent.
            </p>
            <div className="flex space-x-3">
              <a href="https://twitter.com/afritalent" target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-800 rounded-lg hover:bg-amber-500 transition-colors">
                <Twitter className="h-4 w-4" />
              </a>
              <a href="https://linkedin.com/company/afritalent" target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-800 rounded-lg hover:bg-amber-500 transition-colors">
                <Linkedin className="h-4 w-4" />
              </a>
              <a href="https://instagram.com/afritalent" target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-800 rounded-lg hover:bg-amber-500 transition-colors">
                <Instagram className="h-4 w-4" />
              </a>
              <a href="https://youtube.com/afritalent" target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-800 rounded-lg hover:bg-amber-500 transition-colors">
                <Youtube className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">For Talent</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/jobs" className="hover:text-amber-400 transition-colors">Browse Jobs</Link></li>
              <li><Link to="/companies" className="hover:text-amber-400 transition-colors">Company Reviews</Link></li>
              <li><Link to="/salary" className="hover:text-amber-400 transition-colors">Salary Insights</Link></li>
              <li><Link to="/career-advice" className="hover:text-amber-400 transition-colors">Career Advice</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">For Employers</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/post-job" className="hover:text-amber-400 transition-colors">Post a Job</Link></li>
              <li><Link to="/talent-search" className="hover:text-amber-400 transition-colors">Search Talent</Link></li>
              <li><Link to="/pricing" className="hover:text-amber-400 transition-colors">Pricing Plans</Link></li>
              <li><Link to="/employer-branding" className="hover:text-amber-400 transition-colors">Employer Branding</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">Contact Us</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-amber-500" />
                <a href="mailto:hello@afritalent.com" className="hover:text-amber-400 transition-colors">hello@afritalent.com</a>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-amber-500" />
                <a href="tel:+2348001234567" className="hover:text-amber-400 transition-colors">+234 800 123 4567</a>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-amber-500 mt-0.5" />
                <span>Lagos, Nigeria<br />Nairobi, Kenya<br />Accra, Ghana</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} AfriTalent. All rights reserved.
          </p>
          <div className="flex space-x-6 text-sm text-slate-500">
            <Link to="/privacy" className="hover:text-amber-400 transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-amber-400 transition-colors">Terms of Service</Link>
            <Link to="/cookies" className="hover:text-amber-400 transition-colors">Cookie Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
