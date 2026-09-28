ALTER TABLE leads ADD COLUMN type_label TEXT;
ALTER TABLE leads ADD COLUMN editorial_summary TEXT;
ALTER TABLE leads ADD COLUMN reviews_json TEXT;
ALTER TABLE leads ADD COLUMN last_review_at TEXT;
ALTER TABLE audits ADD COLUMN site_description TEXT;
