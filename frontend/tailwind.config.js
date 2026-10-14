/** @type {import('tailwindcss').Config} */
// Direction design (docs/venteloc/SPEC.md §11) : fond clair, palette navy (texte) / surface / bordures / action teal
// (#0f766e, survol #115e59), vert réservé aux badges de vérification, ambre pour les alertes (DPE, impayés), pastilles
// DPE aux couleurs réglementaires. Les mêmes valeurs sont déclarées en variables CSS dans src/index.css (:root).
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
  			sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  			display: ['Manrope', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
  		},
  		fontSize: {
  			// Aucun texte engageant sous 13 px : la plus petite taille utilitaire est relevée à 13 px / 1,4
  			xs: ['0.8125rem', { lineHeight: '1.4' }]
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			// Identité (SPEC §11). `brand.navy` : texte ; `brand.teal` : action (boutons, liens, focus) ;
  			// `brand.green` : uniquement les badges de vérification. `brand.blue` est l'ancien nom de la couleur
  			// d'action, conservé comme alias de teal (toutes les pages héritées passent ainsi à la nouvelle palette).
  			brand: {
  				navy: '#0b1220',
  				'navy-light': '#1a2436',
  				ink: '#070c16',
  				teal: '#0f766e',
  				'teal-dark': '#115e59',
  				'teal-soft': '#f0fdfa',
  				'teal-line': '#99f6e4',
  				green: '#15803d',
  				'green-dark': '#166534',
  				'green-soft': '#dcfce7',
  				blue: '#0f766e',
  				'blue-soft': '#f0fdfa',
  				amber: '#b45309',
  				'amber-soft': '#fef3c7',
  				surface: '#f5f7fa',
  				line: '#e3e7ee'
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
