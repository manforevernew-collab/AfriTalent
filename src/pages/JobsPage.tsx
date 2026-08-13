import React from 'react';
import SEO from '../components/SEO';
import { Briefcase, MapPin, Clock, DollarSign, Search, Filter } from 'lucide-react';

const jobList = [
  { id: 1, title: 'Senior Frontend Developer', company: 'Andela', location: 'Lagos, Nigeria', type: 'Full-time', salary: '$3,000 - $5,000/mo', posted: '2 days ago', tags: ['React', 'TypeScript', 'Remote'] },
  { id: 2, title: 'Product Manager', company: 'Flutterwave', location: 'Lagos, Nigeria', type: 'Full-time', salary: '$4,000 - $6,500/mo', posted: '1 day ago', tags: ['Product', 'Fintech', 'Agile'] },
  { id: 3, title: 'Data Scientist', company: 'Safaricom', location: 'Nairobi, Kenya', type: 'Full-time', salary: '$2,500 - $4,000/mo', posted: '3 days ago', tags: ['Python', 'ML', 'SQL'] },
  { id: 4, title: 'UX Designer', company: 'Jumia', location: 'Remote', type: 'Contract', salary: '$2,000 - $3,500/mo', posted: '5 days ago', tags: ['Figma', 'UI/UX', 'Research'] },
  { id: 5, title: 'DevOps Engineer', company: 'Paystack', location: 'Lagos, Nigeria', type: 'Full-time', salary: '$3,500 - $5,500/mo', posted: '1 week ago', tags: ['AWS', 'Docker', 'K8s'] },
];

export default function JobsPage() {
  return (
    <>
      <SEO title="Browse Jobs" description="Find your next opportunity on AfriTalent." canonical="https://afritalent.com/jobs" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Find Your Dream Job</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">Browse thousands of opportunities across Africa.</p>
        </div>
        <div className="flex flex-col md:flex-row gap-4 mb-10">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <input type="text" placeholder="Job title, keywords, or company" className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-xl text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <button className="flex items-center justify-center gap-2 px-6 py-4 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"><Filter className="h-5 w-5" /> Filters</button>
          <button className="px-8 py-4 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors">Search Jobs</button>
        </div>
        <div className="space-y-4">
          {jobList.map((j) => (
            <div key={j.id} className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">{j.title}</h3>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                    <span className="flex items-center gap-1"><Briefcase className="h-4 w-4" />{j.company}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{j.location}</span>
                    <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{j.posted}</span>
                    <span className="flex items-center gap-1"><DollarSign className="h-4 w-4" />{j.salary}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {j.tags.map((t) => <span key={t} className="px-3 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full">{t}</span>)}
                    <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">{j.type}</span>
                  </div>
                </div>
                <button className="px-6 py-2.5 bg-amber-500 text-white text-sm font-medium rounded-xl hover:bg-amber-600 transition-colors whitespace-nowrap">Apply Now</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
