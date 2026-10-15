/** @type {import('tailwindcss').Config} */
// Charte AlterEgo (design system « AlterEgo », thème WordPress 2.2.6 ; docs/venteloc/SPEC.md §11) : papier, encre, une
// seule couleur de marque (la brique) et des pictogrammes au trait. Les noms historiques `brand.*` sont conservés et
// pointent vers la charte : `navy`/`ink` = encre, `teal` = action (encre, survol brique), `surface` = papier,
// `green` = vérification (vert sauge foncé sur sauge), `amber` = alertes. Mêmes valeurs dans src/index.css (:root).
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html",
    // Le HTML statique généré par le pré-rendu utilise les mêmes classes que les pages React
    "./scripts/**/*.mjs"
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ['"Instrument Sans"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
  			display: ['"Bricolage Grotesque"', '"Instrument Sans"', '"Helvetica Neue"', 'Arial', 'sans-serif']
  		},
  		fontSize: {
  			// Aucun texte engageant sous 13 px : la plus petite taille utilitaire est relevée à 13 px / 1,4
  			xs: ['0.8125rem', { lineHeight: '1.4' }]
  		},
  		borderRadius: {
  			card: '20px',
  			panel: '18px',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			// Charte AlterEgo. `brand.bronze` (brique) : la seule couleur, rare (survols, surtitres, filets, focus) ;
  			// `brand.teal-dark` = brique foncée pour un texte brique de petite taille sur fond teinté (5,7:1).
  			brand: {
  				navy: '#141413',
  				'navy-light': '#2b2a27',
  				ink: '#141413',
  				'ink-2': '#4a4740',
  				'ink-3': '#5b5b5b',
  				'ink-4': '#6c675e',
  				paper: '#fbf8f3',
  				sand: '#efe9df',
  				sauge: '#dce3d5',
  				bronze: '#b94e33',
  				'bronze-dark': '#9c3f27',
  				'bronze-light': '#e0a08a',
  				'bronze-soft': '#f6ece6',
  				'on-ink-2': '#c9c5bd',
  				'on-ink-3': '#a8a49c',
  				teal: '#141413',
  				'teal-dark': '#9c3f27',
  				'teal-soft': '#f6ece6',
  				'teal-line': '#e8c9bc',
  				green: '#3f5e3b',
  				'green-dark': '#2f472c',
  				'green-soft': '#dce3d5',
  				blue: '#141413',
  				'blue-soft': '#efe9df',
  				amber: '#8a4510',
  				'amber-soft': '#f5ead8',
  				surface: '#fbf8f3',
  				line: '#ddd6ca',
  				error: '#a32d2d'
  			},
  			// Gris chauds de la charte (ink-2, ink-3, ink-4) à la place des gris froids par défaut
  			gray: {
  				50: '#faf7f2',
  				100: '#f3eee6',
  				200: '#e6e0d5',
  				300: '#d3cbbd',
  				400: '#a8a49c',
  				500: '#6c675e',
  				600: '#5b5b5b',
  				700: '#4a4740',
  				800: '#2b2a27',
  				900: '#141413'
  			},
  			// Étiquette énergie (arrêté du 31 mars 2021) : couleurs réglementaires des classes A à G
  			dpe: {
  				A: '#009c6d',
  				B: '#52b153',
  				C: '#a5cc74',
  				D: '#f4e70f',
  				E: '#f0b40f',
  				F: '#eb8235',
  				G: '#d7221f'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		boxShadow: {
  			menu: '0 24px 48px -24px rgba(20,20,19,.3)',
  			float: '0 30px 50px -30px rgba(20,20,19,.5)',
  			panel: '0 40px 60px -40px rgba(20,20,19,.35)'
  		},
  		maxWidth: {
  			content: '1240px'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
