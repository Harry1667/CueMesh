import { usePreferences } from '../lib/preferences';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Chrome,
  Layers3,
  MousePointer2,
  ShieldCheck,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { Link } from '../components/Link';
import { MeshScene } from '../components/MeshScene';
import { PreferencesControls } from '../components/PreferencesControls';
import { ModelLineup } from '../components/ModelLineup';
import { Users } from 'lucide-react';
import '../styles/landing.css';
import '../styles/team.css';

const chapters = [
  {
    id: 'context',
    number: '01',
    label: 'A cue is enough.',
    titleTop: 'Show it.',
    titleBottom: 'Skip the setup.',
    description:
      'A passage, a reference, the part of a page that matters. Choose your context in Chrome and tell CueMesh what you want to do.',
    detail: 'You control the scope. The task starts with what you choose to share.',
  },
  {
    id: 'team',
    number: '02',
    label: 'Right context. Right agent.',
    titleTop: 'Your tools.',
    titleBottom: 'Working together.',
    description:
      'CueMesh breaks the goal into focused tasks and routes them to available agents. Useful handoffs replace the back-and-forth between separate conversations.',
    detail: 'Follow who is doing what, which model is assigned, and where the work goes next.',
  },
  {
    id: 'result',
    number: '03',
    label: 'The whole picture stays with you.',
    titleTop: 'Less relaying.',
    titleBottom: 'More arriving.',
    description:
      'The website brings the run together: progress, agent messages, source references, and the final artifacts. Open the result without losing how you got there.',
    detail:
      'Browser actions and their approvals stay in your extension. This is your view of the work.',
  },
];

export function Landing() {
  const { t } = usePreferences();

  const story = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    let observer: IntersectionObserver;
    const observe = () => {
      observer?.disconnect();
      // IntersectionObserver percentage margins use width, even vertically.
      // Pixels keep this center band valid on wide and short viewports.
      const inset = Math.floor(window.innerHeight * 0.45);
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries
            .filter((item) => item.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (entry) setPhase(Number((entry.target as HTMLElement).dataset.chapter));
        },
        { rootMargin: `-${inset}px 0px -${inset}px 0px`, threshold: 0 },
      );
      story.current
        ?.querySelectorAll('[data-chapter]')
        .forEach((element) => observer.observe(element));
    };
    observe();
    window.addEventListener('resize', observe);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', observe);
    };
  }, []);
  return (
    <div className="landing">
      <a className="skip-link" href="#main-content">
        {t('Skip to content')}
      </a>
      <header className="site-header">
        <Brand />
        <nav aria-label={t('Main navigation')}>
          <a href="#how-it-works">{t('How it works')}</a>
          <a href="#your-work">{t('The workspace')}</a>
        </nav>
        <Link href="/workspace" className="button button--dark">
          {t('Open workspace')}
          <ArrowUpRight size={15} />
        </Link>
        <PreferencesControls />
      </header>
      <main id="main-content">
        <section className="hero">
          <div className="hero-heading">
            <div className="eyebrow">
              <span className="signal-dot" />
              {t('THE SPACE BETWEEN YOU AND AI, REIMAGINED.')}
            </div>
            <h1>
              {t('One cue.')}
              <br />
              <span>{t('A whole team.')}</span>
            </h1>
            <div className="hero-bottom">
              <p>{t('One brief. Different strengths.')}</p>
              <Link href="/workspace" className="text-link">
                {t('Step into CueMesh')}
                <ArrowUpRight size={20} />
              </Link>
            </div>
          </div>
          <div className="hero-visual">
            <MeshScene hero />
            <div className="hero-visual-caption">
              <span>{t('Example routing')}</span>
              <span>{t('Research → Coding')}</span>
            </div>
          </div>
          <ModelLineup />
          <a className="scroll-cue" href="#how-it-works">
            <span>{t('Follow the thought')}</span>
            <ArrowDown size={16} />
          </a>
        </section>
        <section
          id="how-it-works"
          className="story"
          ref={story}
          aria-label={t('How CueMesh works')}
        >
          <div className="story-intro">
            <span className="eyebrow">{t('THE WAY THROUGH')}</span>
            <p>
              {t('You shouldn’t have to be')}
              <br />
              <strong>{t('the messenger between your AI tools.')}</strong>
            </p>
          </div>
          <div className="story-layout">
            <div className="story-chapters">
              {chapters.map((chapter, index) => (
                <article
                  className="story-chapter"
                  id={chapter.id}
                  data-chapter={index}
                  key={chapter.id}
                >
                  <span className="chapter-label">
                    <b>{chapter.number}</b>
                    {t(chapter.label)}
                  </span>
                  <h2>
                    {t(chapter.titleTop)}
                    <br />
                    {t(chapter.titleBottom)}
                  </h2>
                  <p>{t(chapter.description)}</p>
                </article>
              ))}
            </div>
            <div className="story-stage">
              <div className="story-stage-inner">
                <MeshScene phase={phase} />
                <div className="scene-index" aria-label={t('Story stages')}>
                  {chapters.map((chapter, index) => (
                    <a
                      href={`#${chapter.id}`}
                      key={chapter.id}
                      aria-current={phase === index ? 'step' : undefined}
                    >
                      <span>{chapter.number}</span>
                      {t(['Context', 'Team', 'Result'][index])}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="work-intro" id="your-work">
          <div className="work-heading">
            <span className="eyebrow">{t('A PLACE FOR THE WHOLE PROCESS')}</span>
            <h2>
              {t('See the work.')}
              <br />
              <em>{t('Not just the answer.')}</em>
            </h2>
            <p>
              {t(
                'One project view keeps your runs, agent handoffs, and artifacts close. Every result has a trail you can inspect.',
              )}
            </p>
            <Link href="/workspace" className="button button--lime">
              {t('Explore the workspace')}
              <ArrowRight size={17} />
            </Link>
          </div>
          <div
            className="workspace-vignette"
            aria-label={t('Illustration of the CueMesh project overview')}
          >
            <div className="vignette-top">
              <span className="signal-dot" />
              {t('Materials atlas')}
              <span>{t('EXAMPLE RUN')}</span>
            </div>
            <div className="vignette-title">
              {t('From reference')}
              <br />
              {t('to first version.')}
              <ArrowUpRight size={36} />
            </div>
            <div className="vignette-steps">
              <div>
                <b>01</b>
                <span>
                  {t('Establish the direction')}
                  <small>{t('Research → Coding')}</small>
                </span>
                <span>✓</span>
              </div>
              <div>
                <b>02</b>
                <span>
                  {t('Shape the first version')}
                  <small>{t('Coding → Review')}</small>
                </span>
                <span>✓</span>
              </div>
              <div>
                <b>03</b>
                <span>
                  {t('Close the loop')}
                  <small>{t('Result + sources + notes')}</small>
                </span>
                <span>✓</span>
              </div>
            </div>
            <div className="vignette-artifact">
              <Layers3 size={18} />
              <span>{t('Everything stays with the run.')}</span>
              <ArrowUpRight size={16} />
            </div>
          </div>
        </section>
        <section className="team-introduction">
          <div>
            <span className="eyebrow">{t('A SHARED BRIEF. YOUR OWN TOOLS.')}</span>
            <h2>
              {t('Different work.')}
              <br />
              {t('Shared direction.')}
            </h2>
            <p>
              {t(
                'You shape the frontend. Your teammate builds the backend. CueMesh keeps the shared context, handoffs, and questions with the project.',
              )}
            </p>
            <Link href="/team" className="text-link">
              {t('Meet your team workspace')}
              <ArrowUpRight size={18} />
            </Link>
          </div>
          <div
            className="team-story-panel"
            aria-label={t('Illustration of shared frontend and backend responsibilities')}
          >
            <span>{t('ILLUSTRATIVE TEAM PROJECT')}</span>
            <div>
              <strong>{t('Frontend')}</strong>
              <span>{t('Interface & experience')}</span>
            </div>
            <Users size={25} />
            <div>
              <strong>{t('Backend')}</strong>
              <span>{t('Accounts & data')}</span>
            </div>
            <p>{t('One project. Each person stays in control.')}</p>
          </div>
        </section>
        <section className="principles" aria-label={t('Product principles')}>
          <div className="principle">
            <MousePointer2 />
            <h3>
              {t('Your context.')}
              <br />
              {t('Your call.')}
            </h3>
            <p>{t('Choose the content that matters. Keep unrelated work out of the task.')}</p>
          </div>
          <div className="principle">
            <Chrome />
            <h3>
              {t('Work in Chrome.')}
              <br />
              {t('Follow it here.')}
            </h3>
            <p>
              {t(
                'The extension executes. Your workspace gives the project a clear, continuous view.',
              )}
            </p>
          </div>
          <div className="principle">
            <ShieldCheck />
            <h3>
              {t('Control stays')}
              <br />
              {t('with you.')}
            </h3>
            <p>
              {t(
                'Review consequential browser actions in the extension. API keys stay out of this website.',
              )}
            </p>
          </div>
        </section>
        <section className="closing">
          <span className="eyebrow">{t('ONE CUE. EVERY AI.')}</span>
          <h2>{t('Keep the idea moving.')}</h2>
          <Link href="/workspace" className="button button--dark">
            {t('Open CueMesh')}
            <ArrowUpRight size={18} />
          </Link>
          <p>
            {t(
              'Hackathon frontend preview. Live synchronization requires the backend integration.',
            )}
          </p>
        </section>
      </main>
      <footer className="site-footer">
        <Brand />
        <p>{t('Context connects the work.')}</p>
        <a href="https://github.com/Harry1667/CueMesh" target="_blank" rel="noreferrer">
          {t('The project')}
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
