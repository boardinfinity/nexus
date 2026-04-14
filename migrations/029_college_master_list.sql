-- Migration 029: College Master List enhancements
-- Adds degree_level, ranking, and LinkedIn slug for alumni scraping

-- New columns on colleges table
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS degree_level TEXT;  -- MBA, Engineering, Medical, Law, etc.
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS ranking_source TEXT;  -- NIRF, QS, Times, etc.
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS ranking_year INTEGER;
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS ranking_score NUMERIC(6,2);
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS linkedin_slug TEXT;  -- e.g. "iim-ahmedabad" for alumni scraping

-- Indexes
CREATE INDEX IF NOT EXISTS idx_colleges_degree_level ON colleges(degree_level);
CREATE INDEX IF NOT EXISTS idx_colleges_ranking ON colleges(ranking_source, ranking_year);
CREATE INDEX IF NOT EXISTS idx_colleges_linkedin_slug ON colleges(linkedin_slug);
CREATE INDEX IF NOT EXISTS idx_colleges_country ON colleges(country);
CREATE INDEX IF NOT EXISTS idx_colleges_state ON colleges(state);

-- Seed: NIRF 2025 Top 50 MBA Colleges
INSERT INTO colleges (name, short_name, city, state, country, degree_level, nirf_rank, ranking_source, ranking_year, ranking_score, tier, linkedin_slug)
VALUES
  ('Indian Institute of Management Ahmedabad', 'IIM Ahmedabad', 'Ahmedabad', 'Gujarat', 'India', 'MBA', 1, 'NIRF', 2025, 83.29, 'Top 10', 'indian-institute-of-management-ahmedabad'),
  ('Indian Institute of Management Bangalore', 'IIM Bangalore', 'Bengaluru', 'Karnataka', 'India', 'MBA', 2, 'NIRF', 2025, 81.56, 'Top 10', 'indian-institute-of-management-bangalore'),
  ('Indian Institute of Management Kozhikode', 'IIM Kozhikode', 'Kozhikode', 'Kerala', 'India', 'MBA', 3, 'NIRF', 2025, 79.85, 'Top 10', 'indian-institute-of-management-kozhikode'),
  ('Indian Institute of Technology Delhi', 'IIT Delhi (DMS)', 'New Delhi', 'Delhi', 'India', 'MBA', 4, 'NIRF', 2025, 78.94, 'Top 10', 'indian-institute-of-technology-delhi'),
  ('Indian Institute of Management Lucknow', 'IIM Lucknow', 'Lucknow', 'Uttar Pradesh', 'India', 'MBA', 5, 'NIRF', 2025, 77.97, 'Top 10', 'indian-institute-of-management-lucknow'),
  ('Indian Institute of Management Mumbai', 'IIM Mumbai', 'Mumbai', 'Maharashtra', 'India', 'MBA', 6, 'NIRF', 2025, 77.58, 'Top 10', 'iim-mumbai'),
  ('Indian Institute of Management Calcutta', 'IIM Calcutta', 'Kolkata', 'West Bengal', 'India', 'MBA', 7, 'NIRF', 2025, 77.34, 'Top 10', 'indian-institute-of-management-calcutta'),
  ('Indian Institute of Management Indore', 'IIM Indore', 'Indore', 'Madhya Pradesh', 'India', 'MBA', 8, 'NIRF', 2025, 75.68, 'Top 10', 'indian-institute-of-management-indore'),
  ('Management Development Institute', 'MDI Gurgaon', 'Gurugram', 'Haryana', 'India', 'MBA', 9, 'NIRF', 2025, 71.96, 'Top 10', 'management-development-institute'),
  ('XLRI - Xavier School of Management', 'XLRI Jamshedpur', 'Jamshedpur', 'Jharkhand', 'India', 'MBA', 10, 'NIRF', 2025, 70.63, 'Top 10', 'xlri-jamshedpur'),
  ('Symbiosis Institute of Business Management', 'SIBM Pune', 'Pune', 'Maharashtra', 'India', 'MBA', 11, 'NIRF', 2025, 67.90, 'Top 25', 'symbiosis-institute-of-business-management'),
  ('Indian Institute of Technology Kharagpur', 'IIT Kharagpur (VGSOM)', 'Kharagpur', 'West Bengal', 'India', 'MBA', 12, 'NIRF', 2025, 66.97, 'Top 25', 'indian-institute-of-technology-kharagpur'),
  ('Indian Institute of Technology Madras', 'IIT Madras (DOMS)', 'Chennai', 'Tamil Nadu', 'India', 'MBA', 13, 'NIRF', 2025, 66.50, 'Top 25', 'indian-institute-of-technology-madras'),
  ('Indian Institute of Technology Bombay', 'IIT Bombay (SJMSOM)', 'Mumbai', 'Maharashtra', 'India', 'MBA', 14, 'NIRF', 2025, 65.82, 'Top 25', 'indian-institute-of-technology-bombay'),
  ('Indian Institute of Management Raipur', 'IIM Raipur', 'Raipur', 'Chhattisgarh', 'India', 'MBA', 15, 'NIRF', 2025, 65.03, 'Top 25', 'indian-institute-of-management-raipur'),
  ('Indian Institute of Management Tiruchirappalli', 'IIM Trichy', 'Tiruchirappalli', 'Tamil Nadu', 'India', 'MBA', 16, 'NIRF', 2025, 64.95, 'Top 25', 'indian-institute-of-management-tiruchirappalli'),
  ('Indian Institute of Foreign Trade', 'IIFT Delhi', 'New Delhi', 'Delhi', 'India', 'MBA', 17, 'NIRF', 2025, 62.93, 'Top 25', 'indian-institute-of-foreign-trade'),
  ('Indian Institute of Management Ranchi', 'IIM Ranchi', 'Ranchi', 'Jharkhand', 'India', 'MBA', 18, 'NIRF', 2025, 62.77, 'Top 25', 'indian-institute-of-management-ranchi'),
  ('Indian Institute of Management Rohtak', 'IIM Rohtak', 'Rohtak', 'Haryana', 'India', 'MBA', 19, 'NIRF', 2025, 62.60, 'Top 25', 'indian-institute-of-management-rohtak-official'),
  ('S. P. Jain Institute of Management and Research', 'SPJIMR Mumbai', 'Mumbai', 'Maharashtra', 'India', 'MBA', 20, 'NIRF', 2025, 62.06, 'Top 25', 'sp-jain-institute-of-management-and-research'),
  ('Indian Institute of Management Udaipur', 'IIM Udaipur', 'Udaipur', 'Rajasthan', 'India', 'MBA', 21, 'NIRF', 2025, 61.79, 'Top 25', 'indian-institute-of-management-udaipur'),
  ('Indian Institute of Technology Roorkee', 'IIT Roorkee', 'Roorkee', 'Uttarakhand', 'India', 'MBA', 22, 'NIRF', 2025, 61.77, 'Top 25', 'indian-institute-of-technology-roorkee'),
  ('Indian Institute of Management Kashipur', 'IIM Kashipur', 'Kashipur', 'Uttarakhand', 'India', 'MBA', 23, 'NIRF', 2025, 61.74, 'Top 25', 'indian-institute-of-management-kashipur'),
  ('SVKM''s Narsee Monjee Institute of Management Studies', 'NMIMS Mumbai', 'Mumbai', 'Maharashtra', 'India', 'MBA', 24, 'NIRF', 2025, 60.99, 'Top 25', 'nmims'),
  ('Indian Institute of Management Nagpur', 'IIM Nagpur', 'Nagpur', 'Maharashtra', 'India', 'MBA', 25, 'NIRF', 2025, 60.88, 'Top 25', 'indian-institute-of-management-nagpur'),
  ('Amrita Vishwa Vidyapeetham', 'Amrita Coimbatore', 'Coimbatore', 'Tamil Nadu', 'India', 'MBA', 26, 'NIRF', 2025, 60.25, 'Top 50', 'amrita-vishwa-vidyapeetham'),
  ('Indian Institute of Technology Kanpur', 'IIT Kanpur', 'Kanpur', 'Uttar Pradesh', 'India', 'MBA', 27, 'NIRF', 2025, 59.97, 'Top 50', 'indian-institute-of-technology-kanpur'),
  ('Jamia Millia Islamia', 'Jamia Delhi', 'New Delhi', 'Delhi', 'India', 'MBA', 28, 'NIRF', 2025, 59.96, 'Top 50', 'jamia-millia-islamia'),
  ('Indian Institute of Management Visakhapatnam', 'IIM Vizag', 'Visakhapatnam', 'Andhra Pradesh', 'India', 'MBA', 29, 'NIRF', 2025, 59.95, 'Top 50', 'indian-institute-of-management-visakhapatnam'),
  ('Institute of Management Technology', 'IMT Ghaziabad', 'Ghaziabad', 'Uttar Pradesh', 'India', 'MBA', 30, 'NIRF', 2025, 59.85, 'Top 50', 'institute-of-management-technology-ghaziabad'),
  ('Indian Institute of Management Bodh Gaya', 'IIM Bodh Gaya', 'Gaya', 'Bihar', 'India', 'MBA', 31, 'NIRF', 2025, 59.65, 'Top 50', 'indian-institute-of-management-bodh-gaya'),
  ('Chandigarh University', 'CU Mohali', 'Mohali', 'Punjab', 'India', 'MBA', 32, 'NIRF', 2025, 59.40, 'Top 50', 'chandigarh-university'),
  ('MICA', 'MICA Ahmedabad', 'Ahmedabad', 'Gujarat', 'India', 'MBA', 33, 'NIRF', 2025, 59.22, 'Top 50', 'mica-ahmedabad'),
  ('Indian Institute of Management Sambalpur', 'IIM Sambalpur', 'Sambalpur', 'Odisha', 'India', 'MBA', 34, 'NIRF', 2025, 58.59, 'Top 50', 'indian-institute-of-management-sambalpur'),
  ('Indian Institute of Management Jammu', 'IIM Jammu', 'Jammu', 'Jammu and Kashmir', 'India', 'MBA', 35, 'NIRF', 2025, 58.50, 'Top 50', 'indian-institute-of-management-jammu'),
  ('UPES', 'UPES Dehradun', 'Dehradun', 'Uttarakhand', 'India', 'MBA', 36, 'NIRF', 2025, 58.33, 'Top 50', 'upes-dehradun'),
  ('Great Lakes Institute of Management', 'Great Lakes Chennai', 'Chennai', 'Tamil Nadu', 'India', 'MBA', 37, 'NIRF', 2025, 58.05, 'Top 50', 'great-lakes-institute-of-management'),
  ('Indian Institute of Management Shillong', 'IIM Shillong', 'Shillong', 'Meghalaya', 'India', 'MBA', 38, 'NIRF', 2025, 57.70, 'Top 50', 'indian-institute-of-management-shillong'),
  ('T. A. Pai Management Institute', 'TAPMI Manipal', 'Manipal', 'Karnataka', 'India', 'MBA', 39, 'NIRF', 2025, 57.13, 'Top 50', 'ta-pai-management-institute-manipal'),
  ('International Management Institute Delhi', 'IMI Delhi', 'New Delhi', 'Delhi', 'India', 'MBA', 40, 'NIRF', 2025, 56.59, 'Top 50', 'international-management-institute-new-delhi'),
  ('Jaipuria Institute of Management', 'Jaipuria Noida', 'Noida', 'Uttar Pradesh', 'India', 'MBA', 41, 'NIRF', 2025, 56.46, 'Top 50', 'jaipuria-institute-of-management-noida'),
  ('IMI Kolkata', 'IMI Kolkata', 'Kolkata', 'West Bengal', 'India', 'MBA', 42, 'NIRF', 2025, 55.42, 'Top 50', 'imi-kolkata'),
  ('Goa Institute of Management', 'GIM Goa', 'Sanquelim', 'Goa', 'India', 'MBA', 43, 'NIRF', 2025, 55.27, 'Top 50', 'goa-institute-of-management'),
  ('Lovely Professional University', 'LPU', 'Phagwara', 'Punjab', 'India', 'MBA', 44, 'NIRF', 2025, 55.00, 'Top 50', 'lovely-professional-university'),
  ('XIM University', 'XIM Bhubaneswar', 'Bhubaneswar', 'Odisha', 'India', 'MBA', 45, 'NIRF', 2025, 54.73, 'Top 50', 'xim-university'),
  ('ICFAI Foundation for Higher Education', 'ICFAI Hyderabad', 'Hyderabad', 'Telangana', 'India', 'MBA', 46, 'NIRF', 2025, 54.40, 'Top 50', 'icfai-business-school'),
  ('Thapar Institute of Engineering and Technology', 'Thapar Patiala', 'Patiala', 'Punjab', 'India', 'MBA', 46, 'NIRF', 2025, 54.40, 'Top 50', 'thapar-institute-of-engineering-technology'),
  ('Indian Institute of Technology (ISM) Dhanbad', 'IIT ISM Dhanbad', 'Dhanbad', 'Jharkhand', 'India', 'MBA', 48, 'NIRF', 2025, 54.34, 'Top 50', 'indian-institute-of-technology-indian-school-of-mines-dhanbad'),
  ('Amity University', 'Amity Noida', 'Noida', 'Uttar Pradesh', 'India', 'MBA', 49, 'NIRF', 2025, 54.15, 'Top 50', 'amity-university'),
  ('Great Lakes Institute of Management Gurgaon', 'Great Lakes Gurgaon', 'Gurgaon', 'Haryana', 'India', 'MBA', 50, 'NIRF', 2025, 54.08, 'Top 50', 'great-lakes-institute-of-management-gurgaon')
ON CONFLICT (name) DO UPDATE SET
  short_name = EXCLUDED.short_name,
  degree_level = EXCLUDED.degree_level,
  nirf_rank = EXCLUDED.nirf_rank,
  ranking_source = EXCLUDED.ranking_source,
  ranking_year = EXCLUDED.ranking_year,
  ranking_score = EXCLUDED.ranking_score,
  tier = EXCLUDED.tier,
  linkedin_slug = EXCLUDED.linkedin_slug,
  state = EXCLUDED.state,
  city = EXCLUDED.city,
  country = EXCLUDED.country;

-- Verify
-- SELECT name, short_name, nirf_rank, tier, degree_level, linkedin_slug FROM colleges WHERE degree_level = 'MBA' ORDER BY nirf_rank;
