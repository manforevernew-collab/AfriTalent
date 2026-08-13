import React from 'react';
import { Helmet } from 'react-helmet-async';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  ogImage?: string;
  ogType?: string;
  canonical?: string;
}

export default function SEO({
  title = "AfriTalent - Discover Africa's Top Talent & Leading Companies",
  description = "AfriTalent is Africa's premier platform connecting skilled professionals with leading employers. Browse jobs, read honest company reviews, and accelerate your career.",
  keywords = 'AfriTalent, Africa jobs, African talent, job search Africa, company reviews, careers Nigeria, careers Kenya, careers Ghana, remote jobs Africa',
  ogImage = '/og-image.jpg',
  ogType = 'website',
  canonical = 'https://afritalent.com',
}: SEOProps) {
  const fullTitle = title.includes('AfriTalent') ? title : `${title} | AfriTalent`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <link rel="canonical" href={canonical} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:site_name" content="AfriTalent" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
      <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <meta name="theme-color" content="#F59E0B" />
    </Helmet>
  );
}
