import React from 'react';
import { Link } from 'react-router-dom';
import { Search, Building2, Briefcase, Star, TrendingUp, Users, Award, Globe } from 'lucide-react';
import SEO from '../components/SEO';

export default function HomePage() {
  return (
    <>
      <SEO />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-10 w-72 h-72 bg-amber-500 rounded-full blur-3xl"></div>
            <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-500 rounded-full blur-3xl"></div>
          </div>

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
            <div className="text-center max-w-3xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
                Discover Africa's
                <span className="text-amber-400"> Top Talent</span>
                <br />& Leading Companies
              </h1>
              <p className="text-lg md:text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
                AfriTalent connects skilled professionals with Africa's best employers. 
                Read honest reviews, find your dream job, and grow your career.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Job title, company, or keyword"
                    className="w-full pl-12 pr-4 py-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <button className="px-8 py-4 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors">
                  Search Jobs
                </button>
              </div>

              <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-400">
                <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-400" /> 50,000+ Jobs</span>
                <span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-amber-400" /> 12,000+ Companies</span>
                <span className="flex items-center gap-2"><Users className="h-4 w-4 text-amber-400" /> 2M+ Professionals</span>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                { value: '2M+', label: 'Active Users', icon: Users },
                { value: '50K+', label: 'Job Listings', icon: Briefcase },
                { value: '12K+', label: 'Companies', icon: Building2 },
                { value: '150K+', label: 'Reviews', icon: Star },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <stat.icon className="h-8 w-8 text-amber-500 mx-auto mb-3" />
                  <div className="text-3xl font-bold text-slate-900">{stat.value}</div>
                  <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Why Choose AfriTalent?</h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                The most trusted platform for career growth and talent discovery across Africa.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                { icon: Search, title: 'Smart Job Matching', desc: 'AI-powered recommendations that match your skills and aspirations with the perfect opportunities.' },
                { icon: Star, title: 'Honest Reviews', desc: 'Read verified employee reviews and salary insights before you apply. Make informed decisions.' },
                { icon: Building2, title: 'Top Employers', desc: "Connect with Africa's leading companies, from startups to Fortune 500s operating on the continent." },
                { icon: Award, title: 'Verified Profiles', desc: 'Stand out with skill-verified profiles and professional credentials that employers trust.' },
                { icon: Globe, title: 'Pan-African Network', desc: 'Access opportunities across Nigeria, Kenya, Ghana, South Africa, and 40+ African countries.' },
                { icon: TrendingUp, title: 'Career Growth', desc: 'Get personalized career advice, salary benchmarks, and learning resources to level up.' },
              ].map((feature) => (
                <div key={feature.title} className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-5">
                    <feature.icon className="h-6 w-6 text-amber-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-3">{feature.title}</h3>
                  <p className="text-slate-600 leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-amber-500">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">Ready to Accelerate Your Career?</h2>
            <p className="text-lg text-amber-100 mb-10 max-w-2xl mx-auto">
              Join millions of professionals who trust AfriTalent to find their next big opportunity.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/signup" className="px-8 py-4 bg-white text-amber-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors">
                Create Free Account
              </Link>
              <Link to="/post-job" className="px-8 py-4 bg-amber-700 text-white font-semibold rounded-xl hover:bg-amber-800 transition-colors border border-amber-400">
                Post a Job
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
