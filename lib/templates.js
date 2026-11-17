'use strict';
/**
 * Premium email templates (Trial, Standard and Premium plans). The free "Recommended" template
 * lives in the browser; these bodies are only sent to signed-in users on a paid plan.
 */
const sign = ['Best regards,', '{{my_name}}', '{{my_contact}}', '{{my_links}}'];

const TEMPLATES = [
  {
    id: 'concise',
    name: 'Short & direct',
    desc: 'Five lines. Best for busy recruiters and follow-ups on job portals.',
    subject: '{{role}} application – {{my_name}}',
    body: [
      'Hi {{first_name|there}},', '',
      "I'm {{my_name}} and I'm applying for {{role}} roles at {{company|your company}}.", '',
      '{{intro}}', '',
      'My resume is attached. Could we set up a quick call this week?', '',
      'Thanks,', '{{my_name}}', '{{my_contact}}', '{{my_links}}',
    ],
  },
  {
    id: 'fresher',
    name: 'Fresher / graduate',
    desc: 'For your first job: puts learning ability and projects first.',
    subject: 'Fresher application: {{role}} – {{my_name}}',
    body: [
      'Dear {{first_name|Hiring Manager}},', '',
      'I am a recent graduate keen to begin my career as {{role}} at {{company|your organization}}.', '',
      '{{intro}}', '',
      '{{highlights}}', '',
      'I learn quickly, enjoy solving problems, and would value the chance to grow with your team. My resume is attached, and I am available for an interview at your convenience.', '',
      'Thank you for considering my application.', '',
      ...sign,
    ],
  },
  {
    id: 'experienced',
    name: 'Experienced professional',
    desc: 'Leads with impact and results. For 2+ years of experience.',
    subject: 'Experienced {{role}} – {{my_name}}',
    body: [
      'Dear {{first_name|Hiring Manager}},', '',
      'I am reaching out about {{role}} opportunities at {{company|your organization}}. I believe my experience would let me contribute from day one.', '',
      '{{intro}}', '',
      '{{highlights}}', '',
      "My resume, attached, has more detail on my work and results. I would welcome a short conversation about your team's priorities and how I can help.", '',
      ...sign,
    ],
  },
  {
    id: 'referral',
    name: 'Referral request',
    desc: 'Ask an employee at the company to refer you.',
    subject: 'Referral request: {{role}} at {{company|your company}}',
    body: [
      'Hi {{first_name|there}},', '',
      "I hope you're doing well. I'm very interested in {{role}} openings at {{company|your company}}, and since you work there, I wanted to ask whether you would be open to referring me.", '',
      '{{intro}}', '',
      "I've attached my resume so you can judge the fit. If a referral isn't possible, any advice on the hiring process would also help a lot.", '',
      'Thank you for your time!', '',
      'Best,', '{{my_name}}', '{{my_contact}}', '{{my_links}}',
    ],
  },
  {
    id: 'followup',
    name: 'Follow-up',
    desc: 'A polite nudge one or two weeks after your first email.',
    subject: 'Following up: {{role}} application – {{my_name}}',
    body: [
      'Hi {{first_name|there}},', '',
      "I hope you're doing well. I'm following up on my application for {{role}} opportunities at {{company|your organization}}. I'm still very interested in joining your team.", '',
      '{{intro}}', '',
      "I've attached my resume again for convenience. Please let me know if you need anything else from me, or if there's a good time to talk.", '',
      'Thank you,', '{{my_name}}', '{{my_contact}}', '{{my_links}}',
    ],
  },
  {
    id: 'switch',
    name: 'Career switch',
    desc: 'Explains a move into a new field with transferable skills.',
    subject: '{{role}} application – {{my_name}}',
    body: [
      'Dear {{first_name|Hiring Manager}},', '',
      'I am writing to apply for {{role}} opportunities at {{company|your organization}}. I am moving into this field and bring skills from my previous work that transfer directly to the role.', '',
      '{{intro}}', '',
      '{{highlights}}', '',
      'I have been building my skills in this area and I am excited to apply them full-time. My resume is attached, and I would be grateful for the chance to discuss how my background can add value to your team.', '',
      'Kind regards,', '{{my_name}}', '{{my_contact}}', '{{my_links}}',
    ],
  },
  {
    id: 'internship',
    name: 'Internship request',
    desc: 'For students looking for an internship or trainee role.',
    subject: 'Internship application: {{role}} – {{my_name}}',
    body: [
      'Dear {{first_name|Hiring Manager}},', '',
      'I am a student writing to ask about internship opportunities in {{role}} at {{company|your organization}}.', '',
      '{{intro}}', '',
      'I am eager to learn, contribute to real projects and gain hands-on experience with your team. My resume is attached, and I can start at a time that suits you.', '',
      'Thank you for your time and consideration.', '',
      ...sign,
    ],
  },
].map((t) => ({ ...t, body: t.body.join('\n') }));

const list = () => TEMPLATES.map(({ id, name, desc }) => ({ id, name, desc }));
const full = () => TEMPLATES.map(({ id, name, desc, subject, body }) => ({ id, name, desc, subject, body }));

module.exports = { list, full };
