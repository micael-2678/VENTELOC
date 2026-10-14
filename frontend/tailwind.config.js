/** @type {import('tailwindcss').Config} */
// Direction design (docs/refonte-2026-10/SPEC.md §5.3) : fond clair, un seul bloc sombre, palette
// navy / surface / bordures / action, vert réservé aux badges de vérification, ambre pour les alertes.
// Les mêmes valeurs sont déclarées en variables CSS dans src/index.css (:root).
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
  			// Identité (SPEC §5.3). `brand.navy` reste la couleur du texte et des boutons ;
  			// `brand.green` est réservé aux badges de vérification et à la fin du nom de marque (logo).
  			brand: {
  				navy: '#0b1220',
  				'navy-light': '#1a2436',
  				ink: '#070c16',
  				green: '#15803d',
  				'green-dark': '#166534',
  				'green-soft': '#dcfce7',
  				blue: '#1d4ed8',
  				'blue-soft': '#eff6ff',
  				amber: '#b45309',
  				'amber-soft': '#fef3c7',
  				surface: '#f5f7fa',
  				line: '#e3e7ee'
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
