-- Sample Test Attempts Data
-- Run this after schema.sql and sample_data.sql

-- Clear existing test attempts (optional - only if you want to reset)
-- DELETE FROM user_answers;
-- DELETE FROM user_test_attempts;

-- Sample test attempts (student có user_id = 3, teacher có user_id = 2)
INSERT INTO user_test_attempts (user_id, test_id, start_time, end_time, total_correct, total_questions, score, time_spent, is_completed) VALUES
(3, 1, '2024-01-15 10:00:00', '2024-01-15 11:15:00', 42, 50, 84, 4500, true),
(3, 1, '2024-01-20 14:30:00', '2024-01-20 15:45:00', 38, 50, 76, 4200, true),
(3, 2, '2024-01-25 09:00:00', '2024-01-25 11:00:00', 78, 100, 78, 7200, true),
(2, 1, '2024-01-16 13:00:00', '2024-01-16 14:10:00', 45, 50, 90, 4100, true),
(2, 2, '2024-01-22 10:00:00', '2024-01-22 12:00:00', 85, 100, 85, 7000, true)
ON CONFLICT DO NOTHING;

-- Note: user_answers will be created when students actually take tests
-- For now, we just have the attempt records

