// Cities scanned by the business importer and the categories shown in the UI.
// bbox = [south, west, north, east]

export const CITIES = [
  { name: 'Lagos', country: 'Nigeria', bbox: [6.40, 3.20, 6.70, 3.65] },
  { name: 'Abuja', country: 'Nigeria', bbox: [8.95, 7.30, 9.15, 7.55] },
  { name: 'Port Harcourt', country: 'Nigeria', bbox: [4.75, 6.95, 4.90, 7.10] },
  { name: 'Ibadan', country: 'Nigeria', bbox: [7.30, 3.80, 7.48, 3.98] },
  { name: 'Kano', country: 'Nigeria', bbox: [11.95, 8.45, 12.05, 8.60] },
  { name: 'Accra', country: 'Ghana', bbox: [5.52, -0.30, 5.68, -0.10] },
  { name: 'Kumasi', country: 'Ghana', bbox: [6.63, -1.68, 6.73, -1.56] },
  { name: 'Nairobi', country: 'Kenya', bbox: [-1.40, 36.70, -1.20, 36.95] },
  { name: 'Mombasa', country: 'Kenya', bbox: [-4.10, 39.60, -3.95, 39.72] },
  { name: 'Kampala', country: 'Uganda', bbox: [0.25, 32.50, 0.40, 32.67] },
  { name: 'Kigali', country: 'Rwanda', bbox: [-2.02, 29.98, -1.90, 30.15] },
  { name: 'Dar es Salaam', country: 'Tanzania', bbox: [-6.90, 39.15, -6.70, 39.32] },
  { name: 'Addis Ababa', country: 'Ethiopia', bbox: [8.92, 38.68, 9.08, 38.85] },
  { name: 'Johannesburg', country: 'South Africa', bbox: [-26.30, 27.90, -26.05, 28.15] },
  { name: 'Cape Town', country: 'South Africa', bbox: [-34.05, 18.35, -33.85, 18.65] },
  { name: 'Durban', country: 'South Africa', bbox: [-29.95, 30.95, -29.78, 31.08] },
  { name: 'Pretoria', country: 'South Africa', bbox: [-25.80, 28.12, -25.68, 28.30] },
  { name: 'Cairo', country: 'Egypt', bbox: [29.95, 31.15, 30.15, 31.40] },
  { name: 'Casablanca', country: 'Morocco', bbox: [33.52, -7.70, 33.63, -7.50] },
  { name: 'Tunis', country: 'Tunisia', bbox: [36.76, 10.12, 36.86, 10.25] },
  { name: 'Dakar', country: 'Senegal', bbox: [14.65, -17.52, 14.78, -17.38] },
  { name: 'Abidjan', country: "Côte d'Ivoire", bbox: [5.27, -4.08, 5.42, -3.92] },
  { name: 'Lusaka', country: 'Zambia', bbox: [-15.48, 28.22, -15.35, 28.38] },
  { name: 'Harare', country: 'Zimbabwe', bbox: [-17.88, 30.98, -17.75, 31.12] },
  { name: 'Gaborone', country: 'Botswana', bbox: [-24.72, 25.85, -24.58, 25.98] },
  { name: 'Windhoek', country: 'Namibia', bbox: [-22.62, 17.03, -22.52, 17.12] },
  { name: 'Luanda', country: 'Angola', bbox: [-8.92, 13.15, -8.78, 13.30] },
  { name: 'Maputo', country: 'Mozambique', bbox: [-26.00, 32.53, -25.90, 32.62] },
]

export const BUSINESS_COUNTRIES = [...new Set(CITIES.map(c => c.country))].sort()

export const BUSINESS_CATEGORIES = [
  'Technology', 'Finance & Banking', 'Legal', 'Consulting', 'Real Estate', 'Healthcare', 'Education',
  'Food & Drink', 'Hospitality', 'Retail', 'Logistics & Transport', 'Telecommunications', 'Marketing & Media',
  'Recruitment', 'Construction & Engineering', 'Energy', 'Automotive', 'Beauty & Wellness', 'Non-profit',
  'Manufacturing', 'Agriculture', 'Professional Services', 'Other',
]

// OSM tag value -> category
const MAP = {
  office: {
    it: 'Technology', software: 'Technology', telecommunication: 'Telecommunications', company: 'Professional Services',
    financial: 'Finance & Banking', insurance: 'Finance & Banking', accountant: 'Finance & Banking', tax_advisor: 'Finance & Banking',
    financial_advisor: 'Finance & Banking', lawyer: 'Legal', notary: 'Legal', consulting: 'Consulting', estate_agent: 'Real Estate',
    property_management: 'Real Estate', employment_agency: 'Recruitment', advertising_agency: 'Marketing & Media',
    newspaper: 'Marketing & Media', architect: 'Construction & Engineering', engineer: 'Construction & Engineering',
    construction_company: 'Construction & Engineering', logistics: 'Logistics & Transport', courier: 'Logistics & Transport',
    moving_company: 'Logistics & Transport', energy_supplier: 'Energy', ngo: 'Non-profit', association: 'Non-profit',
    foundation: 'Non-profit', charity: 'Non-profit', educational_institution: 'Education', travel_agent: 'Hospitality',
    research: 'Professional Services', coworking: 'Professional Services', airline: 'Logistics & Transport', bank: 'Finance & Banking',
  },
  amenity: {
    bank: 'Finance & Banking', bureau_de_change: 'Finance & Banking', money_transfer: 'Finance & Banking',
    clinic: 'Healthcare', hospital: 'Healthcare', doctors: 'Healthcare', dentist: 'Healthcare', pharmacy: 'Healthcare', veterinary: 'Healthcare',
    restaurant: 'Food & Drink', cafe: 'Food & Drink', fast_food: 'Food & Drink', bar: 'Food & Drink', pub: 'Food & Drink',
    school: 'Education', college: 'Education', university: 'Education', kindergarten: 'Education', language_school: 'Education',
    driving_school: 'Education', fuel: 'Energy', car_rental: 'Automotive', car_wash: 'Automotive', coworking_space: 'Professional Services',
  },
  tourism: { hotel: 'Hospitality', guest_house: 'Hospitality', hostel: 'Hospitality', apartment: 'Hospitality' },
  craft: { _: 'Manufacturing', electrician: 'Construction & Engineering', plumber: 'Construction & Engineering', tailor: 'Retail', caterer: 'Food & Drink' },
  shop: {
    _: 'Retail', car: 'Automotive', car_repair: 'Automotive', car_parts: 'Automotive', tyres: 'Automotive',
    hairdresser: 'Beauty & Wellness', beauty: 'Beauty & Wellness', cosmetics: 'Beauty & Wellness', massage: 'Beauty & Wellness',
    mobile_phone: 'Telecommunications', computer: 'Technology', electronics: 'Technology', bakery: 'Food & Drink',
    agrarian: 'Agriculture', farm: 'Agriculture', travel_agency: 'Hospitality', optician: 'Healthcare', medical_supply: 'Healthcare',
  },
  healthcare: { _: 'Healthcare' },
}

export function categoryFromTags(t) {
  for (const key of ['office', 'amenity', 'healthcare', 'tourism', 'craft', 'shop']) {
    const v = t[key]
    if (!v) continue
    const table = MAP[key]
    if (table[v]) return table[v]
    if (table._) return table._
  }
  return 'Other'
}
