-- Migration: Add image_url column to reading_passages table for Part 7
-- Part 7 passages may contain images (emails, notices, advertisements) 
-- that are better stored as images rather than text to preserve formatting

ALTER TABLE reading_passages 
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add comment
COMMENT ON COLUMN reading_passages.image_url IS 'URL to image file for Part 7 passages (emails, notices, ads)';

