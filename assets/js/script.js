'use strict';

// element toggle function
const elementToggleFunc = function (elem) { elem.classList.toggle("active"); }

// sidebar variables
const sidebar = document.querySelector("[data-sidebar]");
const sidebarBtn = document.querySelector("[data-sidebar-btn]");

// sidebar toggle functionality for mobile
if (sidebarBtn) { // Check if the button exists
    sidebarBtn.addEventListener("click", function () { elementToggleFunc(sidebar); });
}


// contact form variables
const form = document.querySelector("[data-form]");
const formInputs = document.querySelectorAll("[data-form-input]");
const formBtn = document.querySelector("[data-form-btn]");

// add event to all form input field
if (form && formInputs.length > 0 && formBtn) { // Check if form elements exist
    for (let i = 0; i < formInputs.length; i++) {
    formInputs[i].addEventListener("input", function () {

        // check form validation
        if (form.checkValidity()) {
        formBtn.removeAttribute("disabled");
        } else {
        formBtn.setAttribute("disabled", "");
        }

    });
    }
}


// page navigation variables
const navigationLinks = document.querySelectorAll("[data-nav-link]");
const pages = document.querySelectorAll("[data-page]");

// add event to all nav link
if (navigationLinks.length > 0 && pages.length > 0) { // Check if nav elements exist
    for (let i = 0; i < navigationLinks.length; i++) {
        navigationLinks[i].addEventListener("click", function () {

            let targetPage = this.innerHTML.toLowerCase();

            // Deactivate all pages and nav links first
            for (let j = 0; j < pages.length; j++) {
                pages[j].classList.remove("active");
                if (navigationLinks[j]) { // Check if corresponding link exists
                    navigationLinks[j].classList.remove("active");
                }
            }

            // Activate the target page and the clicked nav link
            for (let j = 0; j < pages.length; j++) {
                if (targetPage === pages[j].dataset.page) {
                    pages[j].classList.add("active");
                    this.classList.add("active"); // Activate the clicked link
                    window.scrollTo(0, 0);
                    break; // Exit loop once target page is found
                }
            }

             // If sidebar is active (mobile view), close it after navigation
             if (sidebar && sidebar.classList.contains('active')) {
                elementToggleFunc(sidebar);
            }

        });
    }
}


// Scroll Reveal Animation Logic
const animationTargets = document.querySelectorAll('[data-animation-target]');

const observerOptions = {
  root: null, // relative to the viewport
  rootMargin: '0px',
  threshold: 0.1 // Trigger when 10% of the element is visible
};

const observerCallback = (entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('animated');
      observer.unobserve(entry.target); // Stop observing once animated
    }
  });
};

const scrollObserver = new IntersectionObserver(observerCallback, observerOptions);

if (animationTargets.length > 0) {
    animationTargets.forEach(target => {
        scrollObserver.observe(target);
    });
}

// Initialize Lucide Icons (Called again here for safety, already in HTML)
if (typeof lucide !== 'undefined') {
    lucide.createIcons();
}