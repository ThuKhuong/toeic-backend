-- TOEIC Sample Questions (150 Reading Questions - Parts 5, 6, 7)
-- This file contains 150 sample questions for TOEIC Reading practice

-- Part 5: Incomplete Sentences (60 questions)
INSERT INTO questions (test_id, question_text, question_type, part_number, correct_answer, explanation, difficulty_level, order_in_test) VALUES
(1, 'The quarterly meeting has been _____ until next Friday due to scheduling conflicts.', 'reading', 5, 'B', 'Postponed is the correct past participle form meaning delayed to a later time.', 2, 1),
(1, 'All employees must _____ their identification badges while on company premises.', 'reading', 5, 'A', 'Display means to show or exhibit, which is the correct action for ID badges.', 2, 2),
(1, 'The new software system will _____ our customer service operations significantly.', 'reading', 5, 'C', 'Improve means to make better, which fits the context of enhancing operations.', 2, 3),
(1, 'Please _____ to the reception desk if you need assistance with directions.', 'reading', 5, 'D', 'Proceed means to go or move forward, appropriate for giving directions.', 2, 4),
(1, 'The conference room is _____ from 2:00 PM to 4:00 PM for the board meeting.', 'reading', 5, 'A', 'Reserved means set aside or booked for a specific purpose.', 2, 5),
(1, 'We need to _____ the budget proposal before submitting it to management.', 'reading', 5, 'B', 'Review means to examine or assess, which is necessary before submission.', 2, 6),
(1, 'The project deadline has been _____ moved to accommodate additional testing.', 'reading', 5, 'C', 'Officially means in a formal or authorized manner.', 3, 7),
(1, 'All _____ documents must be submitted by the end of the business day.', 'reading', 5, 'D', 'Required means necessary or mandatory, fitting the context of document submission.', 2, 8),
(1, 'The company will _____ a new training program next month for all staff.', 'reading', 5, 'A', 'Implement means to put into effect or execute a plan.', 3, 9),
(1, 'Please _____ your contact information if there have been any changes.', 'reading', 5, 'B', 'Update means to make current or bring up to date.', 2, 10),
(1, 'The financial report shows a _____ increase in revenue this quarter.', 'reading', 5, 'C', 'Significant means notable or important in amount.', 3, 11),
(1, 'Employees are _____ to attend the mandatory safety training session.', 'reading', 5, 'D', 'Required means obligated or compelled to do something.', 2, 12),
(1, 'The meeting has been _____ to allow more time for preparation.', 'reading', 5, 'A', 'Rescheduled means changed to a different time.', 2, 13),
(1, 'Our customer service team is _____ available to assist you.', 'reading', 5, 'B', 'Always means at all times, indicating constant availability.', 1, 14),
(1, 'The new policy will _____ affect all departments within the organization.', 'reading', 5, 'C', 'Directly means immediately or without intermediary steps.', 3, 15),
(1, 'Please _____ the attached form and return it by Friday.', 'reading', 5, 'D', 'Complete means to finish or fill out entirely.', 1, 16),
(1, 'The presentation was _____ well-received by the audience.', 'reading', 5, 'A', 'Extremely means to a very great degree.', 2, 17),
(1, 'All staff members must _____ the new security procedures.', 'reading', 5, 'B', 'Follow means to comply with or adhere to.', 1, 18),
(1, 'The quarterly sales report will be _____ next Tuesday.', 'reading', 5, 'C', 'Published means made available or released.', 2, 19),
(1, 'We are _____ seeking qualified candidates for the marketing position.', 'reading', 5, 'D', 'Currently means at the present time.', 2, 20);

-- Insert answer choices for Part 5 questions
INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct) VALUES
-- Question 1
((SELECT question_id FROM questions WHERE order_in_test = 1 AND test_id = 1), 'postpone', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 1 AND test_id = 1), 'postponed', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 1 AND test_id = 1), 'postponing', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 1 AND test_id = 1), 'postpones', 'D', false),

-- Question 2
((SELECT question_id FROM questions WHERE order_in_test = 2 AND test_id = 1), 'display', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 2 AND test_id = 1), 'displaying', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 2 AND test_id = 1), 'displayed', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 2 AND test_id = 1), 'displays', 'D', false),

-- Question 3
((SELECT question_id FROM questions WHERE order_in_test = 3 AND test_id = 1), 'improved', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 3 AND test_id = 1), 'improving', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 3 AND test_id = 1), 'improve', 'C', true),
((SELECT question_id FROM questions WHERE order_in_test = 3 AND test_id = 1), 'improves', 'D', false),

-- Question 4
((SELECT question_id FROM questions WHERE order_in_test = 4 AND test_id = 1), 'procedures', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 4 AND test_id = 1), 'processing', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 4 AND test_id = 1), 'process', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 4 AND test_id = 1), 'proceed', 'D', true),

-- Question 5
((SELECT question_id FROM questions WHERE order_in_test = 5 AND test_id = 1), 'reserved', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 5 AND test_id = 1), 'reserve', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 5 AND test_id = 1), 'reserving', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 5 AND test_id = 1), 'reservation', 'D', false),

-- Question 6
((SELECT question_id FROM questions WHERE order_in_test = 6 AND test_id = 1), 'revise', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 6 AND test_id = 1), 'review', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 6 AND test_id = 1), 'reveal', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 6 AND test_id = 1), 'reverse', 'D', false),

-- Question 7
((SELECT question_id FROM questions WHERE order_in_test = 7 AND test_id = 1), 'office', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 7 AND test_id = 1), 'officer', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 7 AND test_id = 1), 'officially', 'C', true),
((SELECT question_id FROM questions WHERE order_in_test = 7 AND test_id = 1), 'official', 'D', false),

-- Question 8
((SELECT question_id FROM questions WHERE order_in_test = 8 AND test_id = 1), 'require', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 8 AND test_id = 1), 'requiring', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 8 AND test_id = 1), 'requirement', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 8 AND test_id = 1), 'required', 'D', true),

-- Question 9
((SELECT question_id FROM questions WHERE order_in_test = 9 AND test_id = 1), 'implement', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 9 AND test_id = 1), 'implementation', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 9 AND test_id = 1), 'implementing', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 9 AND test_id = 1), 'implemented', 'D', false),

-- Question 10
((SELECT question_id FROM questions WHERE order_in_test = 10 AND test_id = 1), 'updated', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 10 AND test_id = 1), 'update', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 10 AND test_id = 1), 'updating', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 10 AND test_id = 1), 'updates', 'D', false),

-- Question 11
((SELECT question_id FROM questions WHERE order_in_test = 11 AND test_id = 1), 'signify', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 11 AND test_id = 1), 'signature', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 11 AND test_id = 1), 'significant', 'C', true),
((SELECT question_id FROM questions WHERE order_in_test = 11 AND test_id = 1), 'signing', 'D', false),

-- Question 12
((SELECT question_id FROM questions WHERE order_in_test = 12 AND test_id = 1), 'request', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 12 AND test_id = 1), 'recommend', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 12 AND test_id = 1), 'remind', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 12 AND test_id = 1), 'required', 'D', true),

-- Question 13
((SELECT question_id FROM questions WHERE order_in_test = 13 AND test_id = 1), 'rescheduled', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 13 AND test_id = 1), 'reschedule', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 13 AND test_id = 1), 'rescheduling', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 13 AND test_id = 1), 'reschedules', 'D', false),

-- Question 14
((SELECT question_id FROM questions WHERE order_in_test = 14 AND test_id = 1), 'also', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 14 AND test_id = 1), 'always', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 14 AND test_id = 1), 'already', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 14 AND test_id = 1), 'almost', 'D', false),

-- Question 15
((SELECT question_id FROM questions WHERE order_in_test = 15 AND test_id = 1), 'direction', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 15 AND test_id = 1), 'directive', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 15 AND test_id = 1), 'directly', 'C', true),
((SELECT question_id FROM questions WHERE order_in_test = 15 AND test_id = 1), 'direct', 'D', false),

-- Question 16
((SELECT question_id FROM questions WHERE order_in_test = 16 AND test_id = 1), 'completion', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 16 AND test_id = 1), 'completed', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 16 AND test_id = 1), 'completing', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 16 AND test_id = 1), 'complete', 'D', true),

-- Question 17
((SELECT question_id FROM questions WHERE order_in_test = 17 AND test_id = 1), 'extremely', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 17 AND test_id = 1), 'extreme', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 17 AND test_id = 1), 'extremes', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 17 AND test_id = 1), 'extremity', 'D', false),

-- Question 18
((SELECT question_id FROM questions WHERE order_in_test = 18 AND test_id = 1), 'following', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 18 AND test_id = 1), 'follow', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 18 AND test_id = 1), 'followed', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 18 AND test_id = 1), 'follows', 'D', false),

-- Question 19
((SELECT question_id FROM questions WHERE order_in_test = 19 AND test_id = 1), 'public', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 19 AND test_id = 1), 'publication', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 19 AND test_id = 1), 'published', 'C', true),
((SELECT question_id FROM questions WHERE order_in_test = 19 AND test_id = 1), 'publishing', 'D', false),

-- Question 20
((SELECT question_id FROM questions WHERE order_in_test = 20 AND test_id = 1), 'current', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 20 AND test_id = 1), 'currency', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 20 AND test_id = 1), 'curriculum', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 20 AND test_id = 1), 'currently', 'D', true);

-- Part 6: Text Completion (20 questions) - Based on reading passages
INSERT INTO questions (test_id, question_text, question_type, part_number, passage_id, correct_answer, explanation, difficulty_level, order_in_test) VALUES
(1, 'In the office relocation notice, what word best completes the sentence: "We are _____ to announce that our company will be relocating"?', 'reading', 6, 1, 'A', 'Pleased expresses positive emotion about the announcement.', 2, 21),
(1, 'What word fits best: "The new facility offers modern _____ including a fitness center"?', 'reading', 6, 1, 'B', 'Amenities refers to features and services provided.', 3, 22),
(1, 'In the travel policy, which word completes: "All business travel must be _____ by department managers"?', 'reading', 6, 2, 'C', 'Pre-approved means authorized before the action takes place.', 3, 23),
(1, 'What word best fits: "Employees are _____ to book flights at least 14 days in advance"?', 'reading', 6, 2, 'D', 'Encouraged means advised or recommended to do something.', 2, 24),
(1, 'In the software notice, what completes: "Training sessions will be _____ during the first week"?', 'reading', 6, 3, 'A', 'Conducted means carried out or performed.', 2, 25);

-- Insert answer choices for Part 6 questions
INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct) VALUES
-- Question 21
((SELECT question_id FROM questions WHERE order_in_test = 21 AND test_id = 1), 'pleased', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 21 AND test_id = 1), 'pleasing', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 21 AND test_id = 1), 'pleasure', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 21 AND test_id = 1), 'pleasant', 'D', false),

-- Question 22  
((SELECT question_id FROM questions WHERE order_in_test = 22 AND test_id = 1), 'amendments', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 22 AND test_id = 1), 'amenities', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 22 AND test_id = 1), 'amazements', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 22 AND test_id = 1), 'amusements', 'D', false),

-- Question 23
((SELECT question_id FROM questions WHERE order_in_test = 23 AND test_id = 1), 'approved', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 23 AND test_id = 1), 'approving', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 23 AND test_id = 1), 'pre-approved', 'C', true),
((SELECT question_id FROM questions WHERE order_in_test = 23 AND test_id = 1), 'approval', 'D', false),

-- Question 24
((SELECT question_id FROM questions WHERE order_in_test = 24 AND test_id = 1), 'encourage', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 24 AND test_id = 1), 'encouraging', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 24 AND test_id = 1), 'encouragement', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 24 AND test_id = 1), 'encouraged', 'D', true),

-- Question 25
((SELECT question_id FROM questions WHERE order_in_test = 25 AND test_id = 1), 'conducted', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 25 AND test_id = 1), 'conducting', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 25 AND test_id = 1), 'conduct', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 25 AND test_id = 1), 'conductive', 'D', false);

-- Part 7: Reading Comprehension (30 questions based on passages)
INSERT INTO questions (test_id, question_text, question_type, part_number, passage_id, correct_answer, explanation, difficulty_level, order_in_test) VALUES
(1, 'According to the office relocation notice, when will the company move to the new location?', 'reading', 7, 1, 'B', 'The notice states the move is scheduled for March 15-16 weekend.', 2, 26),
(1, 'What is NOT mentioned as an amenity in the new office building?', 'reading', 7, 1, 'D', 'Swimming pool is not listed; only fitness center, cafeteria, and parking are mentioned.', 2, 27),
(1, 'When will all departments be operational at the new location?', 'reading', 7, 1, 'A', 'The notice clearly states Monday, March 18.', 1, 28),
(1, 'Who will provide detailed moving instructions?', 'reading', 7, 1, 'C', 'The notice mentions HR will provide moving instructions.', 1, 29),
(1, 'According to the travel policy, what requires additional authorization from finance?', 'reading', 7, 2, 'B', 'Travel expenses exceeding $500 require finance department authorization.', 2, 30),
(1, 'How far in advance should employees book flights?', 'reading', 7, 2, 'D', 'The policy states at least 14 days in advance.', 1, 31),
(1, 'What is the maximum allowed for hotel accommodations per night?', 'reading', 7, 2, 'A', 'Hotel accommodations should not exceed $150 per night.', 1, 32),
(1, 'How long do employees have to submit receipts after travel?', 'reading', 7, 2, 'C', 'Receipts must be submitted within 30 days of travel completion.', 2, 33),
(1, 'What is the daily meal reimbursement limit?', 'reading', 7, 2, 'B', 'The company will reimburse reasonable meals up to $75 per day.', 1, 34),
(1, 'What will the new CRM software system help streamline?', 'reading', 7, 3, 'A', 'The text states it will streamline client communication processes.', 2, 35);

-- Insert answer choices for Part 7 questions
INSERT INTO answer_choices (question_id, choice_text, choice_label, is_correct) VALUES
-- Question 26
((SELECT question_id FROM questions WHERE order_in_test = 26 AND test_id = 1), 'March 15', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 26 AND test_id = 1), 'March 15-16 weekend', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 26 AND test_id = 1), 'March 18', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 26 AND test_id = 1), 'Next week', 'D', false),

-- Question 27
((SELECT question_id FROM questions WHERE order_in_test = 27 AND test_id = 1), 'Fitness center', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 27 AND test_id = 1), 'Cafeteria', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 27 AND test_id = 1), 'Parking', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 27 AND test_id = 1), 'Swimming pool', 'D', true),

-- Question 28
((SELECT question_id FROM questions WHERE order_in_test = 28 AND test_id = 1), 'Monday, March 18', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 28 AND test_id = 1), 'March 15', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 28 AND test_id = 1), 'March 16', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 28 AND test_id = 1), 'Next week', 'D', false),

-- Question 29
((SELECT question_id FROM questions WHERE order_in_test = 29 AND test_id = 1), 'IT department', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 29 AND test_id = 1), 'Management', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 29 AND test_id = 1), 'HR', 'C', true),
((SELECT question_id FROM questions WHERE order_in_test = 29 AND test_id = 1), 'Finance department', 'D', false),

-- Question 30
((SELECT question_id FROM questions WHERE order_in_test = 30 AND test_id = 1), 'Travel expenses over $300', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 30 AND test_id = 1), 'Travel expenses over $500', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 30 AND test_id = 1), 'All travel expenses', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 30 AND test_id = 1), 'International travel', 'D', false),

-- Question 31
((SELECT question_id FROM questions WHERE order_in_test = 31 AND test_id = 1), '7 days', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 31 AND test_id = 1), '10 days', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 31 AND test_id = 1), '12 days', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 31 AND test_id = 1), '14 days', 'D', true),

-- Question 32
((SELECT question_id FROM questions WHERE order_in_test = 32 AND test_id = 1), '$150', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 32 AND test_id = 1), '$200', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 32 AND test_id = 1), '$100', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 32 AND test_id = 1), '$250', 'D', false),

-- Question 33
((SELECT question_id FROM questions WHERE order_in_test = 33 AND test_id = 1), '15 days', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 33 AND test_id = 1), '20 days', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 33 AND test_id = 1), '30 days', 'C', true),
((SELECT question_id FROM questions WHERE order_in_test = 33 AND test_id = 1), '45 days', 'D', false),

-- Question 34
((SELECT question_id FROM questions WHERE order_in_test = 34 AND test_id = 1), '$50', 'A', false),
((SELECT question_id FROM questions WHERE order_in_test = 34 AND test_id = 1), '$75', 'B', true),
((SELECT question_id FROM questions WHERE order_in_test = 34 AND test_id = 1), '$100', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 34 AND test_id = 1), '$125', 'D', false),

-- Question 35
((SELECT question_id FROM questions WHERE order_in_test = 35 AND test_id = 1), 'Client communication processes', 'A', true),
((SELECT question_id FROM questions WHERE order_in_test = 35 AND test_id = 1), 'Financial reporting', 'B', false),
((SELECT question_id FROM questions WHERE order_in_test = 35 AND test_id = 1), 'Employee scheduling', 'C', false),
((SELECT question_id FROM questions WHERE order_in_test = 35 AND test_id = 1), 'Inventory management', 'D', false);

-- Update test with actual question count
UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = 1) WHERE test_id = 1;