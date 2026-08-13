import React from 'react';
import SEO from '../components/SEO';
import { Star, ThumbsUp } from 'lucide-react';

const reviewList = [
  { id: 1, company: 'Andela', rating: 5, title: 'Amazing place to grow your career', content: "The mentorship program is world-class. I've grown more in 2 years here than in 5 years elsewhere. The remote-first culture is genuinely inclusive.", author: 'Sarah O.', role: 'Senior Engineer', date: '2 weeks ago', helpful: 45 },
  { id: 2, company: 'Flutterwave', rating: 4, title: 'Fast-paced and rewarding', content: 'Work-life balance can be challenging during product launches, but the compensation and growth opportunities make it worthwhile. Great team culture.', author: 'Michael K.', role: 'Product Manager', date: '1 month ago', helpful: 32 },
  { id: 3, company: 'Safaricom', rating: 3, title: 'Stable but slow to innovate', content: 'Good benefits and job security, but decision-making can be bureaucratic. If you want stability, this is the place.', author: 'James M.', role: 'Network Engineer', date: '3 weeks ago', helpful: 28 },
];

export default function ReviewsPage() {
  return (
    <>
      <SEO title="Company Reviews" description="Read honest employee reviews for companies across Africa on AfriTalent." canonical="https://afritalent.com/reviews" />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Company Reviews</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">Real reviews from real employees. Get the inside scoop before you apply.</p>
        </div>
        <div className="space-y-6">
          {reviewList.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-sm font-bold text-amber-700">{r.company[0]}</div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{r.company}</h3>
                    <div className="flex items-center gap-1">
                      {[...Array(5)].map((_, i) => <Star key={i} className={`h-4 w-4 ${i < r.rating ? 'text-amber-500 fill-amber-500' : 'text-slate-200'}`} />)}
                    </div>
                  </div>
                </div>
                <span className="text-sm text-slate-400">{r.date}</span>
              </div>
              <h4 className="text-lg font-semibold text-slate-900 mb-2">{r.title}</h4>
              <p className="text-slate-600 leading-relaxed mb-4">{r.content}</p>
              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <div className="text-sm text-slate-500"><span className="font-medium text-slate-700">{r.author}</span> &mdash; {r.role}</div>
                <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-amber-600 transition-colors"><ThumbsUp className="h-4 w-4" /> Helpful ({r.helpful})</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 text-center">
          <button className="px-8 py-3 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors">Write a Review</button>
        </div>
      </div>
    </>
  );
}
