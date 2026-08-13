import React from 'react';
import SEO from '../components/SEO';
import { Building2, MapPin, Star, Search } from 'lucide-react';

const companies = [
  { id: 1, name: 'Andela', location: 'Lagos, Nigeria', rating: 4.5, reviews: 234, industry: 'Technology', logo: 'A' },
  { id: 2, name: 'Flutterwave', location: 'Lagos, Nigeria', rating: 4.3, reviews: 189, industry: 'Fintech', logo: 'F' },
  { id: 3, name: 'Safaricom', location: 'Nairobi, Kenya', rating: 4.1, reviews: 567, industry: 'Telecom', logo: 'S' },
  { id: 4, name: 'Jumia', location: 'Lagos, Nigeria', rating: 3.8, reviews: 412, industry: 'E-commerce', logo: 'J' },
  { id: 5, name: 'M-Pesa', location: 'Nairobi, Kenya', rating: 4.6, reviews: 892, industry: 'Fintech', logo: 'M' },
  { id: 6, name: 'Paystack', location: 'Lagos, Nigeria', rating: 4.7, reviews: 156, industry: 'Fintech', logo: 'P' },
];

export default function BusinessesPage() {
  return (
    <>
      <SEO title="Browse Companies" description="Discover and review top companies across Africa on AfriTalent." canonical="https://afritalent.com/businesses" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Explore Companies</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">Discover Africa's leading employers. Read honest reviews and compare salaries.</p>
        </div>
        <div className="max-w-xl mx-auto mb-12">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <input type="text" placeholder="Search companies by name or industry..." className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {companies.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 bg-amber-100 rounded-xl flex items-center justify-center text-xl font-bold text-amber-700">{c.logo}</div>
                <div className="flex items-center gap-1 bg-amber-50 px-2.5 py-1 rounded-lg">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  <span className="text-sm font-semibold text-amber-700">{c.rating}</span>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-1">{c.name}</h3>
              <p className="text-sm text-amber-600 font-medium mb-2">{c.industry}</p>
              <div className="flex items-center gap-1 text-sm text-slate-500 mb-3"><MapPin className="h-4 w-4" />{c.location}</div>
              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <span className="text-sm text-slate-500">{c.reviews} reviews</span>
                <button className="text-sm font-medium text-amber-600 hover:text-amber-700">View Profile &rarr;</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
