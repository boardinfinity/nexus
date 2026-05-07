-- =============================================================================
-- Migration:  0002_alumni_insights_seed.sql
-- Feature:    Alumni Insights — Tier-1 MBA Bucket Framework Seed Data
-- Description:
--   Seeds the bucket_frameworks, buckets, bucket_ctc_bands, and bucket_companies
--   tables with data from Tier1_MBA_Bucket_Framework.xlsx (Bucket Summary sheet).
--   20 buckets B01-B20 across 9 domains.
--
--   Safe to re-run: all INSERTs use ON CONFLICT DO UPDATE (upsert semantics).
--
--   Seed scope:
--     - 1  bucket_frameworks row  (slug: 'tier1_mba')
--     - 20 buckets rows           (codes: B01-B20)
--     - 20 bucket_ctc_bands rows  (geography: IN, currency: INR, unit: LPA)
--     - 191  bucket_companies rows  (key example companies per bucket)
--
--   CTC figures (p25=CTC_Min, p50=CTC_Median, p75=CTC_Max) are framework-implied
--   estimates from the Bucket Summary sheet. They are NOT per-institution survey data.
--
--   ASSUMPTION: bucket_companies rows are inserted with company_id = NULL because
--   the companies table may not yet have canonical rows for all listed companies.
--   A follow-up enrichment job should resolve company_id using trigram fuzzy
--   matching on idx_bucket_companies_name_trgm.
-- =============================================================================

-- =============================================================================
-- STEP 1 — bucket_frameworks
-- =============================================================================
INSERT INTO bucket_frameworks
    (id, name, slug, target_audience, version, description, is_active)
VALUES (
    gen_random_uuid(),
    'Tier-1 MBA Placement Bucket Framework',
    'tier1_mba',
    'MBA graduates from Tier-1 Indian business schools',
    '1.0',
    '20-bucket classification framework for Indian MBA placements across 9 domains: '
    'Strategy & Management Consulting, Investment Banking & Financial Markets, '
    'Financial Services & BFSI, Marketing & Commercial, General Management & Corporate '
    'Leadership, Technology & Product, Operations & Supply Chain, HR & People, '
    'Analytics & Data Strategy, and Healthcare & Specialty. '
    'CTC bands are India-specific (INR, LPA).',
    true
)
ON CONFLICT (slug) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    version     = EXCLUDED.version,
    updated_at  = now();


-- =============================================================================
-- STEP 2 — buckets (20 rows, B01-B20)
-- =============================================================================
INSERT INTO buckets
    (id, framework_id, code, name, domain, company_tier,
     typical_entry_role, selectivity, sort_order, is_active)
VALUES
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B01', 'MBB Strategy Consulting', 'Strategy & Management Consulting', 'Super (S)', 'Associate / Consultant', 'Very High — top 10-15% of IIM A/B/C', 1, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B02', 'Big 4 Strategy & Advisory Consulting', 'Strategy & Management Consulting', 'Tier 1A', 'Senior Analyst / Consultant', 'High — accessible to IIM A-C, XLRI, FMS, MDI, SPJIMR', 2, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B03', 'Boutique & Tier-2 Management Consulting', 'Strategy & Management Consulting', 'Tier 1B', 'Analyst / Associate Consultant', 'Medium-High — IIM A-C, IIM L/K/I, XLRI, FMS, MDI', 3, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B04', 'IT Consulting, GCC & Digital Transformation', 'Strategy & Management Consulting', 'Tier 2', 'Management Analyst / Business Analyst', 'Medium — accessible to IIM L through NMIMS/IMT range', 4, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B05', 'Bulge Bracket & Premium Investment Banking', 'Investment Banking & Financial Markets', 'Super (S)', 'Associate (IB Division)', 'Very High — primarily IIM A/B/C, XLRI Finance, FMS', 5, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B06', 'Private Equity, VC & Hedge Funds', 'Investment Banking & Financial Markets', 'Super (S)', 'Associate / Investment Analyst', 'Extremely High — almost exclusively IIM A/B/C; few offers', 6, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B07', 'Boutique IB, Debt Markets & Corporate Finance', 'Investment Banking & Financial Markets', 'Tier 1B', 'Associate / Manager – Corporate Finance', 'Medium — IIM A-C, IIM L/K/I, XLRI, SPJIMR', 7, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B08', 'Wealth, Asset Management & Financial Markets', 'Investment Banking & Financial Markets', 'Tier 1B', 'Associate / Relationship Manager (HNI) / Analyst', 'Medium', 8, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B09', 'BFSI Corporate Banking & Management Programs', 'Financial Services & BFSI', 'Tier 2', 'Management Trainee / Deputy Manager', 'Low-Medium — accessible to IIM newer + IIFT/NMIMS/IMT', 9, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B10', 'FMCG Brand Management & Category Marketing', 'Marketing & Commercial', 'Tier 1A', 'Assistant Brand Manager / Brand Executive', 'High — IIM A-C preferred; IIM L/K/I, XLRI, MDI, SPJIMR also place', 10, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B11', 'Commercial Excellence, Enterprise & Channel Sales', 'Marketing & Commercial', 'Tier 1B', 'Area Sales Manager / Key Account Manager', 'Medium — IIM L through NMIMS/IMT range', 11, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B12', 'International Trade, EXIM & Global Commercial', 'Marketing & Commercial', 'Tier 2', 'Manager – International Business', 'Low-Medium — IIFT Delhi/Kolkata primary feeder; some IIM L/K/I', 12, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B13', 'General Management LDPs & Corporate MT Programs', 'General Management & Corporate Leadership', 'Tier 1B', 'Management Trainee / Leadership Associate', 'Medium — accessible to top IIMs + XLRI/FMS/MDI through NMIMS/IMT', 13, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B14', 'Global Tech — Product Management & Business Strategy', 'Technology & Product', 'Super (S)', 'Associate Product Manager / Strategy Analyst', 'Very High — primarily IIM A/B/C + ISB + IIM L for select roles', 14, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B15', 'Indian Tech & Unicorn — PM, Growth & Business Roles', 'Technology & Product', 'Tier 1A', 'Product Manager / Strategy Manager / Growth Lead', 'High — IIM A-C, IIM L/K/I, XLRI, ISB; growing access at MDI/SPJIMR', 15, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B16', 'E-commerce & New-Age Operations Management', 'Operations & Supply Chain', 'Tier 1B', 'Area Manager / Operations Manager', 'Medium — IIM L through NMIMS/IMT; Amazon Ops at all top IIMs', 16, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B17', 'Manufacturing, Supply Chain & Industrial Operations', 'Operations & Supply Chain', 'Tier 2', 'Management Trainee – Ops / Supply Chain Manager', 'Low-Medium — IIM newer campuses, IIFT, NMIMS, IMT', 17, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B18', 'HR Leadership, Talent Strategy & People Operations', 'HR & People', 'Tier 1B', 'HR Business Partner / MT – HR', 'Medium — XLRI HRM stream dominant; IIM Shillong, MDI HR stream', 18, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B19', 'Advanced Analytics, Data Strategy & AI Consulting', 'Analytics & Data Strategy', 'Tier 1A', 'Data Analyst / Analytics Consultant / Decision Scientist', 'Medium-High — accessible to IIM A-C, IIM L/K/I, IIFT, ISB', 19, true),
    (gen_random_uuid(), (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba'), 'B20', 'Healthcare, Pharma Strategy & Specialty Sectors', 'Healthcare & Specialty', 'Tier 2', 'Management Trainee / Business Analyst – Healthcare', 'Low-Medium', 20, true)
ON CONFLICT (framework_id, code) DO UPDATE SET
    name               = EXCLUDED.name,
    domain             = EXCLUDED.domain,
    company_tier       = EXCLUDED.company_tier,
    typical_entry_role = EXCLUDED.typical_entry_role,
    selectivity        = EXCLUDED.selectivity,
    sort_order         = EXCLUDED.sort_order,
    updated_at         = now();


-- =============================================================================
-- STEP 3 — bucket_ctc_bands (20 rows, India geography)
--
-- geography   = 'IN'  (India; ISO 3166-1 alpha-2)
-- college_tier = NULL = band applies to all college tiers.
--               College-tier-specific overrides can be added as separate rows.
-- p25 = CTC Min (LPA), p50 = CTC Median (LPA), p75 = CTC Max (LPA)
--
-- Per Q1 decision: bucket-implied bands are the ONLY CTC representation.
-- No per-person salary figures are stored anywhere in the system.
-- =============================================================================
INSERT INTO bucket_ctc_bands
    (id, bucket_id, geography, college_tier, p25, p50, p75, currency, unit, source)
VALUES
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B01' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 45, 58, 80, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B02' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 25, 35, 50, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 22, 30, 42, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 18, 24, 35, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 35, 52, 90, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 30, 50, 80, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 18, 27, 42, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 16, 24, 40, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 14, 20, 30, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 20, 28, 40, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 15, 20, 30, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 16, 22, 35, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 15, 22, 32, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 30, 45, 65, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 22, 35, 55, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 18, 26, 38, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 14, 20, 30, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 14, 20, 30, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 20, 30, 48, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0'),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IN', NULL, 14, 20, 30, 'INR', 'LPA', 'Tier1_MBA_Bucket_Framework_v1.0')
ON CONFLICT (bucket_id, geography, COALESCE(college_tier, -1)) DO UPDATE SET
    p25        = EXCLUDED.p25,
    p50        = EXCLUDED.p50,
    p75        = EXCLUDED.p75,
    source     = EXCLUDED.source,
    updated_at = now();


-- =============================================================================
-- STEP 4 — bucket_companies (191 rows)
--
-- weight = 0.9  first-listed (most canonical) company per bucket
-- weight = 0.8  other key examples
--
-- The Layer 3 bucketing shortcut uses weight >= 0.7 as the threshold to skip
-- an LLM call and assign a bucket deterministically.
--
-- company_id is NULL. A follow-up enrichment job should resolve company_id
-- by matching company_name against the companies table using the trigram index
-- idx_bucket_companies_name_trgm.
-- =============================================================================
INSERT INTO bucket_companies
    (id, bucket_id, company_name, weight)
VALUES
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B01' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'McKinsey & Company', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B01' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Boston Consulting Group', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B01' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Bain & Company', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B02' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Deloitte S&O / Monitor Deloitte', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B02' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'EY-Parthenon', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B02' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'PwC Strategy&', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B02' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'KPMG Advisory', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B02' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Accenture Strategy', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'A.T. Kearney', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Oliver Wyman', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Alvarez & Marsal', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'L.E.K. Consulting', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Arthur D. Little', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Roland Berger', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Strategy&', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B03' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'FTI Consulting', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IBM Consulting (GBS)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ZS Associates', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Cognizant Business Consulting', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Capgemini Invent', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Infosys Consulting', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'KPMG (non-strategy)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'HCL Management Consulting', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Wipro Consulting', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B04' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Fractal Analytics', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Goldman Sachs', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Morgan Stanley', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'JP Morgan', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Barclays', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Citibank', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'UBS', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'HSBC IB', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Deutsche Bank', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B05' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Bank of America', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Warburg Pincus', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'KKR India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ChrysCapital', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Premji Invest', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Multiples Alternate Asset', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'WestBridge Capital', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'A&M PE', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Norwest VP', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Temasek', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'DE Shaw', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B06' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Ares Management', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Avendus Capital', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'JM Financial', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Rothschild India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Lazard India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Axis Capital', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ICICI Securities IB', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Edelweiss IB', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Kotak IB', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B07' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Motilal Oswal IB', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Kotak Wealth Management', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'PGIM India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'HDFC AMC', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Mirae Asset', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'DSP Investments', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Motilal Oswal Wealth', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Edelweiss Wealth', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'NSE/BSE', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'CRISIL', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B08' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'CARE Ratings', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'HDFC Bank (WLP / CLP)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ICICI Bank (PO)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Kotak Mahindra Bank', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Axis Bank', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'SBI', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Bajaj Finance', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IDFC First Bank', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'RBL Bank', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'PayTM', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B09' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Groww', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Hindustan Unilever (HUL)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Procter & Gamble', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Nestle India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ITC (Marketing)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Colgate-Palmolive', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'AB InBev', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Pernod Ricard', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Reckitt', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Mondelēz', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Marico', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B10' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Dabur', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ITC (Sales)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Dabur', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Marico', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Godrej Consumer', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Cipla', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Abbott', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Asian Paints', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Berger', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Reliance Retail', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B11' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Tata Consumer', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Amul (International)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ITC (Agri/Paperboards International)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ONGC Videsh', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'MMTC', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'PEC', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Tata Global Beverages Intl', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Dabur International', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Mahindra International', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Vedanta', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B12' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Hindalco', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Tata Administrative Service (TAS)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Mahindra LDP', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Aditya Birla Management Programme (ABMP)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ITC MT', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'L&T Leadership Development', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Godrej Corporate MT', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Reliance MT', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Bajaj Auto MT', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B13' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Maruti MT', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Amazon (India/AWS)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Google India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Microsoft India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Meta India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Adobe', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Atlassian', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Salesforce', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Cisco', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'SAP', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Oracle', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B14' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Intuit', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Flipkart', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Swiggy', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Zomato', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'PhonePe', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Razorpay', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'CRED', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Meesho', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Zepto', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Groww', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ShareChat', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Dunzo', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Nykaa', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Boat', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Urban Company', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B15' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'OYO', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Amazon (Last Mile / FC)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Flipkart', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Delhivery', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Porter', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Shadowfax', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Zomato Ops', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Blinkit', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'BigBasket', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B16' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Meesho Ops', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Tata Steel', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'L&T', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Mahindra Manufacturing', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Bosch India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), '3M India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Saint-Gobain', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Cummins India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ABG (Hindalco', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'UltraTech)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Asian Paints Supply Chain', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B17' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Maruti Suzuki', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'P&G HR', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Unilever HR (HUL)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Tata Motors HR', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Mahindra HR', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Larsen & Toubro HR', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Godrej HR', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Amazon HR', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Accenture HR', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Deloitte HR Consulting', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B18' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Aon Hewitt', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ZS Associates', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Mu Sigma', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Tiger Analytics', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'McKinsey QuantumBlack', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'BCG Gamma', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Deloitte Analytics', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Accenture AI', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Fractal Analytics', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'CRISIL Analytics', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'American Express Analytics', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B19' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Goldman Sachs Analytics', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Cipla (Strategy)', 0.9),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Dr Reddy''s', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Sun Pharma (Corporate)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Abbott India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'ZS Associates (Pharma Practice)', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'IQVIA', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Boston Scientific', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Medtronic India', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Apollo Hospitals', 0.8),
    (gen_random_uuid(), (SELECT id FROM buckets WHERE code = 'B20' AND framework_id = (SELECT id FROM bucket_frameworks WHERE slug = 'tier1_mba')), 'Manipal Health', 0.8)
ON CONFLICT (bucket_id, company_name) DO UPDATE SET
    weight     = EXCLUDED.weight,
    updated_at = now();


-- =============================================================================
-- VERIFICATION (uncomment to confirm counts after running this seed)
-- =============================================================================
-- SELECT
--     bf.slug,
--     bf.version,
--     COUNT(DISTINCT b.id)   AS bucket_count,
--     COUNT(DISTINCT bc.id)  AS company_mapping_count,
--     COUNT(DISTINCT ctc.id) AS ctc_band_count
-- FROM bucket_frameworks bf
-- LEFT JOIN buckets          b   ON b.framework_id = bf.id
-- LEFT JOIN bucket_companies bc  ON bc.bucket_id   = b.id
-- LEFT JOIN bucket_ctc_bands ctc ON ctc.bucket_id  = b.id
-- WHERE bf.slug = 'tier1_mba'
-- GROUP BY bf.slug, bf.version;
-- Expected: bucket_count = 20, company_mapping_count = 191, ctc_band_count = 20

-- =============================================================================
-- END OF MIGRATION 0002
-- =============================================================================
